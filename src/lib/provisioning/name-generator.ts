import { randomInt } from 'crypto';

/**
 * 120+ common Anglo first names (mixed gender, lowercase)
 * Curated for realistic email accounts that improve deliverability
 */
export const FIRST_NAMES = [
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles',
  'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'kenneth', 'brian', 'paul', 'steven',
  'andrew', 'edward', 'kevin', 'george', 'ronald', 'timothy', 'jason', 'jeffrey', 'frank', 'gary',
  'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel',
  'frank', 'gregory', 'alexander', 'raymond', 'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron',
  'russell', 'adam', 'henry', 'douglas', 'peter', 'zachary', 'kyle', 'walter', 'harold', 'keith',
  'christian', 'roger', 'terry', 'gerald', 'sean', 'austin', 'carl', 'arthur', 'ryan', 'roger',
  // Female names
  'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan', 'jessica', 'sarah', 'karen',
  'nancy', 'lisa', 'betty', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna', 'michelle',
  'carol', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia', 'kathleen',
  'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela', 'emma', 'nicole', 'helen', 'samantha',
  'katherine', 'christine', 'debra', 'rachel', 'catherine', 'carolyn', 'janet', 'ruth', 'maria', 'heather',
  'diane', 'virginia', 'julie', 'joyce', 'victoria', 'olivia', 'kelly', 'christina', 'lauren', 'joan',
];

/**
 * 120+ common Anglo last names (lowercase)
 * Curated for realistic email accounts
 */
export const LAST_NAMES = [
  'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis', 'rodriguez', 'martinez',
  'hernandez', 'lopez', 'gonzalez', 'wilson', 'anderson', 'thomas', 'taylor', 'moore', 'jackson', 'martin',
  'lee', 'perez', 'thompson', 'white', 'harris', 'sanchez', 'clark', 'ramirez', 'lewis', 'robinson',
  'walker', 'young', 'allen', 'king', 'wright', 'scott', 'torres', 'peterson', 'phillips', 'campbell',
  'parker', 'evans', 'edwards', 'collins', 'reeves', 'morris', 'murphy', 'rogers', 'morgan', 'peterson',
  'cooper', 'reed', 'cook', 'morgan', 'bell', 'murphy', 'bailey', 'rivera', 'richmond', 'joyce',
  'matthews', 'arnold', 'ford', 'ryan', 'hunt', 'price', 'bennett', 'palmer', 'santos', 'ross',
  'henderson', 'coleman', 'jenkins', 'perry', 'powell', 'long', 'patterson', 'hughes', 'flowers', 'myers',
  'buchanan', 'shaw', 'holmes', 'rice', 'robertson', 'hunt', 'black', 'daniels', 'carter', 'stephens',
  'nobles', 'brewer', 'hart', 'mcginnis', 'gilmore', 'cain', 'manning', 'mccarthy', 'fisher', 'newman',
  'austin', 'carlton', 'barrett', 'hicks', 'rivera', 'greer', 'graves', 'knight', 'brunswick', 'giles',
  'turner', 'hayes', 'brooks', 'mitchell', 'summers', 'winters', 'patel', 'khan', 'chen', 'wang',
];

/**
 * Generates unique firstname.lastname pairs
 *
 * @param count - Number of unique names to generate
 * @param existingNames - Optional array of names to exclude from generation
 * @returns Array of unique firstname.lastname strings, sorted alphabetically
 * @throws Error if count exceeds available unique combinations
 */
export function generateAccountNames(count: number, existingNames?: string[]): string[] {
  const maxCombinations = FIRST_NAMES.length * LAST_NAMES.length;

  if (count > maxCombinations) {
    throw new Error(
      `Cannot generate ${count} unique names. Maximum possible combinations: ${maxCombinations} ` +
      `(${FIRST_NAMES.length} first names × ${LAST_NAMES.length} last names)`
    );
  }

  const existingSet = new Set<string>(existingNames || []);
  const generated = new Set<string>();

  while (generated.size < count) {
    const firstName = FIRST_NAMES[randomInt(0, FIRST_NAMES.length)];
    const lastName = LAST_NAMES[randomInt(0, LAST_NAMES.length)];
    const fullName = `${firstName}.${lastName}`;

    // Skip if already generated in this batch or exists in external list
    if (!generated.has(fullName) && !existingSet.has(fullName)) {
      generated.add(fullName);
    }

    // Safety check: prevent infinite loops if we're very close to max
    if (generated.size < count && generated.size + existingSet.size > maxCombinations * 0.95) {
      throw new Error(
        `Cannot generate ${count} unique names without exceeding pool capacity. ` +
        `Currently have ${generated.size}, excluding ${existingSet.size} existing names.`
      );
    }
  }

  return Array.from(generated).sort();
}

/**
 * Generates unique account names across all domains in a pair
 * Ensures every account gets a globally unique firstname.lastname
 *
 * @param domainCount - Number of domains in the pair
 * @param accountsPerDomain - Number of accounts per domain
 * @returns Array of arrays: one per domain, each containing unique account names
 * @throws Error if total accounts exceed available unique combinations
 */
export function generateAccountNamesForPair(
  domainCount: number,
  accountsPerDomain: number
): string[][] {
  const totalAccounts = domainCount * accountsPerDomain;
  const maxCombinations = FIRST_NAMES.length * LAST_NAMES.length;

  if (totalAccounts > maxCombinations) {
    throw new Error(
      `Cannot generate ${totalAccounts} unique names across ${domainCount} domains. ` +
      `Maximum possible combinations: ${maxCombinations} ` +
      `(${FIRST_NAMES.length} first names × ${LAST_NAMES.length} last names)`
    );
  }

  // Generate all unique names at once
  const allNames = generateAccountNames(totalAccounts);

  // Distribute names across domains
  const result: string[][] = [];
  let nameIndex = 0;

  for (let domainIdx = 0; domainIdx < domainCount; domainIdx++) {
    const domainNames: string[] = [];
    for (let accountIdx = 0; accountIdx < accountsPerDomain; accountIdx++) {
      domainNames.push(allNames[nameIndex]);
      nameIndex++;
    }
    result.push(domainNames);
  }

  return result;
}
