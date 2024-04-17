export function levenshteinDistance(str1: string, str2: string): number {
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
        let cost = str1.charAt(i - 1) === str2.charAt(j - 1) ? 0 : 1;
  
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
  