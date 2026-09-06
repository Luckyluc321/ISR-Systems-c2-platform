// Assertion: the delimited stream handler must have cleanly split
// body from recommendation using ===RECO===. If the delimiter is
// missing from the model output, both fields end up conflated or one
// is empty.

export default function delimiter(output, fixture, context) {
  const body = output.body || '';
  const reco = output.recommendation || '';

  if (!body.trim()) return { pass: false, message: 'body is empty (delimiter probably missing from stream)' };
  if (!reco.trim()) return { pass: false, message: 'recommendation is empty (delimiter probably missing or reco absent)' };

  // Neither field should contain the raw delimiter marker after parsing.
  if (body.includes('===RECO===')) return { pass: false, message: 'body still contains raw delimiter — handler did not split' };
  if (reco.includes('===RECO===')) return { pass: false, message: 'recommendation still contains raw delimiter' };

  return { pass: true, message: 'ok' };
}
