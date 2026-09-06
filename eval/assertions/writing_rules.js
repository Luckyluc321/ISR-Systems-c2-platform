// Assertion: base writing rules from mistral_client.js WRITING_RULES.
// No em-dashes, no semicolons, no filler words, no markdown.
//
// Applied to both body and recommendation.

const FILLER_WORDS = [
  'furthermore', 'moreover', 'additionally', 'nevertheless',
  'however', 'in conclusion', 'to summarize',
];

const MARKDOWN_PATTERNS = [
  /^\s*#+\s/m,          // heading
  /\*\*[^*]+\*\*/,      // bold
  /(^|\s)\*[^*]+\*(\s|$)/,  // italic
  /^\s*[-*+]\s/m,       // bullet list
  /^\s*\d+\.\s/m,       // numbered list
];

export default function writing_rules(output, fixture, context) {
  const problems = [];
  const both = `${output.body || ''}\n${output.recommendation || ''}`;

  if (both.includes('—') || both.includes('–')) problems.push('contains em-dash or en-dash');
  if (both.includes(';')) problems.push('contains semicolon');

  const lower = both.toLowerCase();
  for (const w of FILLER_WORDS) {
    if (lower.includes(w)) problems.push(`contains filler word "${w}"`);
  }

  for (const pat of MARKDOWN_PATTERNS) {
    if (pat.test(both)) problems.push(`contains markdown pattern ${pat}`);
  }

  return problems.length === 0
    ? { pass: true, message: 'ok' }
    : { pass: false, message: problems.join('; ') };
}
