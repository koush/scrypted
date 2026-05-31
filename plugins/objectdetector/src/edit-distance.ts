// visual similarity
const similarCharacters = [
  ['0', 'O', 'D'],
  ['1', 'I'],
  ['2', 'Z'],
  ['4', 'A'],
  ['5', 'S'],
  ['8', 'B'],
  ['6', 'G'],
  // not sure about this one.
  ['A', '4'],
  ['C', 'G'],
  ['E', 'F'],
];

const similarCharactersMap = new Map<string, Set<string>>();
for (const similarCharacter of similarCharacters) {
  for (const character of similarCharacter) {
    if (!similarCharactersMap.has(character)) {
      similarCharactersMap.set(character, new Set());
    }
    for (const similar of similarCharacter) {
      similarCharactersMap.get(character)!.add(similar);
    }
  }
}

function isSameCharacter(c1: string, c2: string) {
  if (c1 === c2)
    return true;

  return similarCharactersMap.get(c1)?.has(c2);
}

export function levenshteinDistance(str1: string, str2: string): number {
  // todo: handle lower/uppercase similarity in similarCharacters above.
  // ie, b is visualy similar to 6, but does not really look like B.
  // others include e and C. v, u and Y. l, i, 1.
  str1 = str1.toUpperCase();
  str2 = str2.toUpperCase();

  const len1 = str1.length;
  const len2 = str2.length;

  // If either string is empty, the distance is the length of the other string
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  let prev: number[] = new Array(len2 + 1);
  let curr: number[] = new Array(len2 + 1);

  // Initialize the first row of the matrix to be the index of the second string
  for (let i = 0; i <= len2; i++) {
    prev[i] = i;
  }

  for (let i = 1; i <= len1; i++) {
    // Initialize the current row with the distance from the previous row's first element
    curr[0] = i;

    for (let j = 1; j <= len2; j++) {
      let cost = isSameCharacter(str1.charAt(i - 1), str2.charAt(j - 1)) ? 0 : 1;

      // Compute the minimum of three possible operations: insertion, deletion, or substitution
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }

    // Swap the previous and current rows for the next iteration
    const temp = prev;
    prev = curr;
    curr = temp;
  }

  return prev[len2];
}
