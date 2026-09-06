// Assertion: model_version must be present + non-empty on every
// generated artifact. Enables per-artifact provenance ("this narrative
// came from model X on 2026-09-05").

export default function model_version(output, fixture, context) {
  if (!output.model_version || typeof output.model_version !== 'string' || !output.model_version.trim()) {
    return { pass: false, message: 'model_version missing or empty' };
  }
  return { pass: true, message: output.model_version };
}
