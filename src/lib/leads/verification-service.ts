// B11: Reoon Email Verification Service
// IMPORTANT: No module-scope client init — Hard Lesson #34

interface ReoonSingleResult {
  status: string;
  email: string;
  [key: string]: unknown;
}

// Reoon Power-mode `status` values seen in production: safe, invalid, disabled,
// disposable, spamtrap, risky, role_account, catch_all, unknown. Legacy aliases
// ('valid', 'accept_all', 'role') retained for forward-compat in case Reoon renames.
export function mapReoonStatus(status: string): 'valid' | 'invalid' | 'risky' | 'unknown' {
  switch (status?.toLowerCase()) {
    case 'safe':
    case 'valid':
      return 'valid';
    case 'invalid':
    case 'disabled':
    case 'disposable':
    case 'spamtrap':
      return 'invalid';
    case 'risky':
    case 'role_account':
    case 'catch_all':
    case 'accept_all':
    case 'role':
      return 'risky';
    case 'unknown':
    case 'timeout':
    default:
      return 'unknown';
  }
}

export async function verifyEmail(
  apiKey: string,
  email: string
): Promise<{ email_status: 'valid' | 'invalid' | 'risky' | 'unknown'; raw_result: unknown }> {
  const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent(email)}&key=${apiKey}&mode=power`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Reoon API error (${response.status}): ${text}`);
  }

  const result: ReoonSingleResult = await response.json();
  return {
    email_status: mapReoonStatus(result.status),
    raw_result: result,
  };
}

export async function verifyBatch(
  apiKey: string,
  emails: string[]
): Promise<{ email: string; email_status: 'valid' | 'invalid' | 'risky' | 'unknown' }[]> {
  if (emails.length === 0) return [];

  // For batches <= 50: parallel single verification with concurrency limit of 10
  if (emails.length <= 50) {
    const results: { email: string; email_status: 'valid' | 'invalid' | 'risky' | 'unknown' }[] = [];
    const concurrency = 10;

    for (let i = 0; i < emails.length; i += concurrency) {
      const chunk = emails.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        chunk.map(async (email) => {
          const { email_status } = await verifyEmail(apiKey, email);
          return { email, email_status };
        })
      );

      for (const r of settled) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          // On failure, mark as unknown
          const idx = settled.indexOf(r);
          results.push({ email: chunk[idx], email_status: 'unknown' });
        }
      }
    }

    return results;
  }

  // For batches > 50: use bulk API
  const createUrl = 'https://emailverifier.reoon.com/api/v1/bulk/create';
  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails, mode: 'power', key: apiKey }),
  });

  if (!createResponse.ok) {
    throw new Error(`Reoon bulk create error: ${await createResponse.text()}`);
  }

  const { id: jobId } = await createResponse.json();

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 120; // 20 minutes max
  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 10000)); // 10s poll
    attempts++;

    const statusUrl = `https://emailverifier.reoon.com/api/v1/bulk/status?id=${jobId}&key=${apiKey}`;
    const statusResponse = await fetch(statusUrl);
    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    if (statusData.status === 'completed' || statusData.status === 'finished') {
      break;
    }
    if (statusData.status === 'failed') {
      throw new Error('Reoon bulk verification failed');
    }
  }

  // Fetch results
  const resultUrl = `https://emailverifier.reoon.com/api/v1/bulk/result?id=${jobId}&key=${apiKey}`;
  const resultResponse = await fetch(resultUrl);
  if (!resultResponse.ok) {
    throw new Error(`Reoon bulk result error: ${await resultResponse.text()}`);
  }

  const resultData = await resultResponse.json();
  const bulkResults = (resultData.results || resultData.data || []) as ReoonSingleResult[];

  return bulkResults.map((r) => ({
    email: r.email,
    email_status: mapReoonStatus(r.status),
  }));
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `https://emailverifier.reoon.com/api/v1/verify?email=${encodeURIComponent('test@gmail.com')}&key=${apiKey}&mode=power`;
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}
