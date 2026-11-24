import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { detectTextDirection, generateConversationTitle } from './language';
import {
  createStreamAccumulator,
  parseFollowUpSection,
  splitAnswerAndFollowUps,
} from './streamParser';
import {
  buildSystemInstruction,
  resolveEligibleModel,
  sanitizeAttachments,
  validateChatRequest,
} from './chatValidation';
import {
  extractCsvSummary,
  extractLegacyDocText,
  extractPptxSlidesFromBuffer,
  extractXlsxWorkbookFromBuffer,
  parseCsvRows,
} from './fileProcessor';
import {
  IMAGE_UNAVAILABLE_MESSAGE,
  resolveConfiguredImageModel,
  resolveLiveModel,
} from './models';
import {
  computeLastMessagePreview,
  exportConversationsAsJson,
  exportConversationsAsTxt,
  mergeImportedConversations,
  parseImportedConversations,
  sanitizeConversations,
} from './storage';
import { tokenizeCodeLine } from './syntaxHighlight';
import {
  extractClientIp,
  isPublicRoutableIp,
  isValidIanaTimeZone,
  normalizeIpCandidate,
} from '../../server/location';
import { extractGroundingSourcesFromChunk } from '../../server/gemini';
import {
  getImageProviderAvailability,
  validateImageGenerationRequest,
} from '../../server/imageProvider';
import type { GroundingSource } from '../types/chat';

test('detectTextDirection identifies Urdu RTL vs English and Roman Urdu LTR', () => {
  assert.equal(detectTextDirection('Explain Next.js in simple terms.'), 'ltr');
  assert.equal(detectTextDirection('Mujhe Next.js samjhao.'), 'ltr');
  assert.equal(detectTextDirection('مجھے جاوا اسکرپٹ سمجھائیں۔'), 'rtl');
  assert.equal(detectTextDirection('مجھے JavaScript اور React سکھائیں۔'), 'rtl');
  assert.equal(detectTextDirection('   '), 'ltr');
});

test('generateConversationTitle creates clean bounded titles', () => {
  assert.equal(generateConversationTitle('   '), 'New conversation');
  assert.equal(generateConversationTitle('What is AI?'), 'What is AI?');
  const long =
    'How can a small consulting business structure quarterly financial reviews effectively?';
  const title = generateConversationTitle(long);
  assert.ok(title.length <= 47);
  assert.ok(title.endsWith('…'));
});

test('createStreamAccumulator buffers split marker chunks without leaking marker text', () => {
  const acc = createStreamAccumulator();
  const chunks = [
    'Artificial intelligence helps computers ',
    'learn from examples.\n\n---FOLL',
    'OWUPS---\n["How does AI learn?", ',
    '"What are AI risks?", "How can I use AI daily?"]',
  ];

  let visible = '';
  for (const c of chunks) {
    visible += acc.push(c);
  }
  const done = acc.finalize();
  visible += done.remainingDelta;

  assert.equal(visible.trim(), 'Artificial intelligence helps computers learn from examples.');
  assert.equal(visible.includes('FOLLOWUPS'), false);
  assert.deepEqual(done.followUps, [
    'How does AI learn?',
    'What are AI risks?',
    'How can I use AI daily?',
  ]);
});

test('parseFollowUpSection handles fenced JSON and numbered list fallbacks', () => {
  const fenced = '```json\n["One?", "Two?", "Three?", "Four?"]\n```';
  assert.deepEqual(parseFollowUpSection(fenced), ['One?', 'Two?', 'Three?']);

  const numbered = '1. پہلا سوال؟\n2. دوسرا سوال؟\n3. تیسرا سوال؟';
  assert.deepEqual(parseFollowUpSection(numbered), [
    'پہلا سوال؟',
    'دوسرا سوال؟',
    'تیسرا سوال؟',
  ]);

  const split = splitAnswerAndFollowUps('Short answer.\n---FOLLOWUPS---\n["A?", "B?", "C?"]');
  assert.equal(split.answer, 'Short answer.');
  assert.deepEqual(split.followUps, ['A?', 'B?', 'C?']);
});

test('validateChatRequest rejects empty or oversized messages and caps history, defaulting responseLength to balanced', () => {
  assert.equal(validateChatRequest(null).ok, false);
  assert.equal(validateChatRequest({ message: '   ' }).ok, false);
  assert.equal(validateChatRequest({ message: 'a'.repeat(9000) }).ok, false);

  const defReq = validateChatRequest({ message: 'Hello' });
  assert.equal(defReq.ok, true);
  if (defReq.ok) {
    assert.equal(defReq.data.responseLength, 'balanced');
  }

  const quickReq = validateChatRequest({ message: 'Hello', responseLength: 'quick' });
  assert.equal(quickReq.ok, true);
  if (quickReq.ok) {
    assert.equal(quickReq.data.responseLength, 'quick');
  }

  const detailedReq = validateChatRequest({ message: 'Hello', responseLength: 'detailed' });
  assert.equal(detailedReq.ok, true);
  if (detailedReq.ok) {
    assert.equal(detailedReq.data.responseLength, 'detailed');
  }

  const manyTurns = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'model',
    content: `Turn ${i}`,
  }));
  const valid = validateChatRequest({
    message: 'Explain cash flow',
    history: manyTurns,
    responseLength: 'balanced',
    model: 'gemini-3.8-flash',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.history.length, 20);
    assert.equal(valid.data.responseLength, 'balanced');
    assert.equal(valid.data.model, 'gemini-3.8-flash');
  }
});

test('resolveEligibleModel defaults to gemini-3.8-flash and blocks deprecated models', () => {
  assert.equal(resolveEligibleModel('gemini-1.5-pro', null), 'gemini-3.8-flash');
  assert.equal(resolveEligibleModel('gemini-2.0-flash', 'gemini-1.5-flash'), 'gemini-3.8-flash');
  assert.equal(resolveEligibleModel(undefined, 'gemini-4-hydrogen'), 'gemini-4-hydrogen');
  assert.equal(resolveEligibleModel('gemini-3.1-flash-lite', 'gemini-3.8-flash'), 'gemini-3.1-flash-lite');
  assert.ok(buildSystemInstruction('concise').includes('---FOLLOWUPS---'));
});

test('export, import, and computeLastMessagePreview validate and merge cleanly', () => {
  const sample = [
    {
      id: 'c1',
      title: 'Strategy review',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user' as const, content: 'Hello', createdAt: 1000 },
        {
          id: 'm2',
          role: 'assistant' as const,
          content: 'How can I assist?',
          createdAt: 1500,
          followUpQuestions: ['Q1?', 'Q2?', 'Q3?'],
        },
      ],
    },
  ];

  assert.equal(computeLastMessagePreview(sample[0].messages), 'How can I assist?');
  const sanitized = sanitizeConversations(sample);
  assert.equal(sanitized[0].lastMessagePreview, 'How can I assist?');

  const json = exportConversationsAsJson(sample);
  const parsed = parseImportedConversations(json);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.conversations.length, 1);
    assert.equal(parsed.conversations[0].messages[1].followUpQuestions?.length, 3);
  }

  const bad = parseImportedConversations('{not valid json');
  assert.equal(bad.ok, false);

  const txt = exportConversationsAsTxt(sample);
  assert.ok(txt.includes('Title: Strategy review'));
  assert.ok(txt.includes('Suggested follow-ups:'));

  const merged = mergeImportedConversations(sample, [
    {
      id: 'c2',
      title: 'Urdu chat',
      createdAt: 3000,
      updatedAt: 3000,
      messages: [],
    },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'c2');
});

test('tokenizeCodeLine identifies keywords, strings, comments, and numbers', () => {
  const tokens = tokenizeCodeLine('const count = 42; // items', 'typescript');
  assert.ok(tokens.some((t) => t.type === 'keyword' && t.value === 'const'));
  assert.ok(tokens.some((t) => t.type === 'number' && t.value === '42'));
  assert.ok(tokens.some((t) => t.type === 'comment' && t.value === '// items'));
});

test('IP validation blocks private/loopback ranges and extracts public client IP safely', () => {
  assert.equal(isPublicRoutableIp('127.0.0.1'), false);
  assert.equal(isPublicRoutableIp('10.0.0.5'), false);
  assert.equal(isPublicRoutableIp('192.168.1.10'), false);
  assert.equal(isPublicRoutableIp('172.16.4.2'), false);
  assert.equal(isPublicRoutableIp('169.254.169.254'), false);
  assert.equal(isPublicRoutableIp('::1'), false);
  assert.equal(isPublicRoutableIp('fe80::1'), false);
  assert.equal(isPublicRoutableIp('8.8.8.8'), true);
  assert.equal(isPublicRoutableIp('1.1.1.1'), true);

  assert.equal(normalizeIpCandidate('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeIpCandidate('203.0.113.9:41234'), '203.0.113.9');
  assert.equal(normalizeIpCandidate('not-an-ip'), undefined);

  assert.equal(
    extractClientIp({ 'x-forwarded-for': '127.0.0.1, 8.8.4.4' }, '127.0.0.1'),
    '8.8.4.4'
  );
  assert.equal(isValidIanaTimeZone('Asia/Karachi'), true);
  assert.equal(isValidIanaTimeZone('Invalid/Zone'), false);
});

test('extractGroundingSourcesFromChunk deduplicates and filters unsafe URLs', () => {
  const seen = new Set<string>();
  const collected: GroundingSource[] = [];
  extractGroundingSourcesFromChunk(
    {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.com/news', title: 'Example News' } },
              { web: { uri: 'https://example.com/news', title: 'Duplicate' } },
              { web: { uri: 'javascript:alert(1)', title: 'Bad XSS' } },
              { web: { uri: 'https://gemini.google.com', title: '' } },
            ],
          },
        },
      ],
    },
    seen,
    collected
  );

  assert.equal(collected.length, 2);
  assert.equal(collected[0].title, 'Example News');
  assert.equal(collected[1].title, 'gemini.google.com');
});

test('buildSystemInstruction injects detected user location and timezone context', () => {
  const prompt = buildSystemInstruction('concise', {
    city: 'Lahore',
    region: 'Punjab',
    country: 'Pakistan',
    timezone: 'Asia/Karachi',
    localTimeFormatted: 'Monday, November 23, 2026 at 4:45 PM PKT',
    source: 'ip+browser',
  });
  assert.ok(prompt.includes('Lahore, Punjab, Pakistan'));
  assert.ok(prompt.includes('Asia/Karachi'));
  assert.ok(prompt.includes('Monday, November 23, 2026'));
});

test('validateChatRequest and buildSystemInstruction handle preferredLanguage safely', () => {
  const valid = validateChatRequest({
    message: 'Explain compound interest',
    history: [],
    responseLength: 'concise',
    preferredLanguage: 'ur',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.preferredLanguage, 'ur');
  }

  const fallback = validateChatRequest({
    message: 'Hello',
    history: [],
    preferredLanguage: 'invalid-lang',
  });
  assert.equal(fallback.ok, true);
  if (fallback.ok) {
    assert.equal(fallback.data.preferredLanguage, 'auto');
  }

  const urPrompt = buildSystemInstruction('concise', undefined, undefined, 'ur');
  assert.ok(urPrompt.includes('Urdu script'));
  const romanPrompt = buildSystemInstruction('concise', undefined, undefined, 'roman-ur');
  assert.ok(romanPrompt.includes('Roman Urdu'));
});

test('parseCsvRows and extractCsvSummary parse quoted commas, newlines, and markdown tables', () => {
  const csv = 'Name,Role,Note\n"Ayla, Khan",Analyst,"Line 1\nLine 2"\nNoor,Engineer,Ready';
  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'Ayla, Khan');
  assert.equal(rows[1][2], 'Line 1\nLine 2');

  const summary = extractCsvSummary(csv);
  assert.equal(summary.rowCount, 3);
  assert.ok(summary.text.includes('CSV Rows: 3 · Columns: 3'));
  assert.ok(summary.text.includes('| Name | Role | Note |'));
  assert.ok(summary.text.includes('Ayla, Khan'));
});

test('extractXlsxWorkbookFromBuffer reads multi-sheet Excel workbooks locally', () => {
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet([
    ['Quarter', 'Revenue', 'Region'],
    ['Q1', 125000, 'Karachi'],
    ['Q2', 148000, 'Lahore'],
  ]);
  const s2 = XLSX.utils.aoa_to_sheet([
    ['Team', 'Headcount'],
    ['Product', 8],
  ]);
  XLSX.utils.book_append_sheet(wb, s1, 'Sales');
  XLSX.utils.book_append_sheet(wb, s2, 'Team');

  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const extracted = extractXlsxWorkbookFromBuffer(raw);
  assert.deepEqual(extracted.sheetNames, ['Sales', 'Team']);
  assert.equal(extracted.totalRows, 5);
  assert.ok(extracted.text.includes('### Worksheet: Sales (3 rows, 3 columns)'));
  assert.ok(extracted.text.includes('| Q1 | 125000 | Karachi |'));
  assert.ok(extracted.text.includes('### Worksheet: Team (2 rows, 2 columns)'));
});

test('extractPptxSlidesFromBuffer extracts slide order and speaker notes locally', async () => {
  const zip = new JSZip();
  zip.file(
    'ppt/slides/slide2.xml',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>Second Slide Summary</a:t></a:p></p:sld>'
  );
  zip.file(
    'ppt/slides/slide1.xml',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>Consul AI Pitch Deck</a:t></a:p><a:p><a:t>Multimodal Roadmap</a:t></a:p></p:sld>'
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:t>Emphasize strictly free architecture.</a:t></a:p></p:notes>'
  );

  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  const result = await extractPptxSlidesFromBuffer(buf);
  assert.equal(result.slideCount, 2);
  assert.ok(result.text.indexOf('[Slide 1]') < result.text.indexOf('[Slide 2]'));
  assert.ok(result.text.includes('Consul AI Pitch Deck'));
  assert.ok(result.text.includes('Speaker notes: Emphasize strictly free architecture.'));
  assert.ok(result.text.includes('Second Slide Summary'));
});

test('extractLegacyDocText recovers readable text from binary .doc bytes or explains fallback', () => {
  const sampleBytes = new TextEncoder().encode('\x00\x01Quarterly Memo: Budget approved for Q4.\x00\x02');
  const res = extractLegacyDocText(sampleBytes.buffer);
  assert.ok(res.text.includes('Quarterly Memo: Budget approved for Q4.'));

  const emptyBytes = new Uint8Array([0, 1, 2, 3]);
  const fallback = extractLegacyDocText(emptyBytes.buffer);
  assert.ok(fallback.text.includes('legacy binary .doc'));
});

test('sanitizeAttachments and validateChatRequest enforce multimodal limits and allow attachment-only sends', () => {
  const tooMany = sanitizeAttachments(
    Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      name: `doc${i}.txt`,
      mimeType: 'text/plain',
      sizeBytes: 100,
      kind: 'text',
      extractedText: 'Sample',
    }))
  );
  assert.ok(tooMany.error);

  const badBase64 = sanitizeAttachments([
    {
      id: 'img1',
      name: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 100,
      kind: 'image',
      inlineImageBase64: 'not!valid!base64***',
    },
  ]);
  assert.ok(badBase64.error);

  const attachmentOnly = validateChatRequest({
    message: '   ',
    attachments: [
      {
        id: 'att1',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        kind: 'document',
        extractedText: 'Revenue grew 14% year-over-year.',
      },
    ],
  });
  assert.equal(attachmentOnly.ok, true);
  if (attachmentOnly.ok) {
    assert.equal(attachmentOnly.data.attachments?.length, 1);
    assert.equal(attachmentOnly.data.attachments?.[0].name, 'report.pdf');
  }
});

test('resolveLiveModel, resolveConfiguredImageModel, and getImageProviderAvailability enforce strict free-only policy', () => {
  assert.equal(resolveLiveModel(undefined), 'gemini-3.8-live');
  assert.equal(resolveLiveModel('gemini-1.5-flash'), 'gemini-3.8-live');
  assert.equal(resolveLiveModel('gemini-3.8-live'), 'gemini-3.8-live');

  assert.deepEqual(resolveConfiguredImageModel(''), { model: undefined, isPaidModel: false });
  assert.deepEqual(resolveConfiguredImageModel('gemini-3.1-flash-lite-image'), {
    model: 'gemini-3.1-flash-lite-image',
    isPaidModel: true,
  });
  assert.deepEqual(resolveConfiguredImageModel('gemini-nano-banana-2.1'), {
    model: 'gemini-nano-banana-2.1',
    isPaidModel: true,
  });

  const prevHf = process.env.HF_API_TOKEN;
  const prevGeminiImg = process.env.GEMINI_IMAGE_MODEL;
  const prevAllowPaid = process.env.ALLOW_PAID_IMAGE_MODEL;
  try {
    delete process.env.HF_API_TOKEN;
    process.env.GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
    delete process.env.ALLOW_PAID_IMAGE_MODEL;

    const status = getImageProviderAvailability();
    assert.equal(status.available, true);
    assert.equal(status.provider, 'pollinations');
  } finally {
    if (prevHf !== undefined) process.env.HF_API_TOKEN = prevHf;
    else delete process.env.HF_API_TOKEN;
    if (prevGeminiImg !== undefined) process.env.GEMINI_IMAGE_MODEL = prevGeminiImg;
    else delete process.env.GEMINI_IMAGE_MODEL;
    if (prevAllowPaid !== undefined) process.env.ALLOW_PAID_IMAGE_MODEL = prevAllowPaid;
    else delete process.env.ALLOW_PAID_IMAGE_MODEL;
  }

  const reqCheck = validateImageGenerationRequest({
    prompt: 'Minimalist studio headphones on stone',
    style: 'product-photography',
    aspectRatio: '16:9',
    count: 2,
  });
  assert.equal(reqCheck.ok, true);
  if (reqCheck.ok) {
    assert.equal(reqCheck.data.count, 2);
    assert.equal(reqCheck.data.aspectRatio, '16:9');
  }
});


