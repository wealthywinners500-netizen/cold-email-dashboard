interface TemplateData {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export function renderTemplate(template: string, data: TemplateData): string {
  if (!template) return "";

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Check top-level fields first
    if (key in data && data[key] != null) {
      return String(data[key]);
    }

    // Check custom_fields
    if (data.custom_fields && key in data.custom_fields && data.custom_fields[key] != null) {
      return String(data.custom_fields[key]);
    }

    // Return empty string for missing fields
    return "";
  });
}

export function renderSubjectLine(subjectLines: string[], data: TemplateData): string {
  if (!subjectLines || subjectLines.length === 0) {
    return "No subject";
  }

  // Random A/B selection
  const index = Math.floor(Math.random() * subjectLines.length);
  return renderTemplate(subjectLines[index], data);
}
