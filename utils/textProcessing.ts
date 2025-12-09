// LMC Calculation Utilities

export const calculateEntropy = (text: string): number => {
  if (!text || text.length < 50) return 0;
  
  const words = text.toLowerCase().match(/\b[a-zàâäéèêëïîôöùûüœæç]{3,}\b/gi) || [];
  if (words.length === 0) return 0;
  
  const freq: Record<string, number> = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  
  let entropy = 0;
  const total = words.length;
  
  Object.values(freq).forEach(count => {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  });
  
  return Math.min(entropy / 10, 1);
};

export const calculateCoherence = (text: string): number => {
  if (!text || text.length < 50) return 0;
  
  const sentences = text.split(/[.!?]\s+/).filter(s => s.length > 20);
  if (sentences.length < 2) return 0.5;
  
  const words = text.toLowerCase().match(/\b[a-zàâäéèêëïîôöùûüœæç]{4,}\b/gi) || [];
  const uniqueWords = new Set(words);
  
  // Repetition Rate
  const repetitionRate = 1 - (uniqueWords.size / Math.max(words.length, 1));
  
  // Sentence Length Coherence
  const avgSentenceLength = words.length / sentences.length;
  const lengthCoherence = Math.min(avgSentenceLength / 20, 1);
  
  // Content Words Ratio
  const stopwords = new Set([
    'cette', 'comme', 'dans', 'pour', 'avec', 'sont', 'leurs', 'plus', 'peut',
    'être', 'fait', 'permet', 'avoir', 'faire', 'entre', 'donc', 'aussi', 'ainsi',
    'selon', 'toute', 'tous', 'était', 'serait', 'pourrait', 'existe', 'autres',
    'chaque', 'peuvent', 'encore', 'toujours', 'quelque', 'certains', 'plusieurs'
  ]);
  const contentWords = words.filter(w => !stopwords.has(w));
  const contentRatio = contentWords.length / Math.max(words.length, 1);
  
  // Negation Complexity
  const negations = text.match(/n'est pas|ne sont pas|n'a pas|ne peut pas|jamais|aucun/gi) || [];
  const negationBonus = Math.min(negations.length / 10, 0.1);
  
  return (repetitionRate * 0.25 + lengthCoherence * 0.35 + contentRatio * 0.3 + negationBonus * 0.1);
};

export const calculateLMCScore = (H: number, C: number, epsilon: number): number => {
  return C / (H + epsilon);
};

export const splitSentences = (text: string): string[] => {
  if (!text) return [];
  return text
    .split(/[.!?]\s+|\n{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 500);
};

export const extractClaims = (text: string): string[] => {
  if (!text || text.length < 100) return [];
  
  const markers = [
    'est ', 'sont ', 'représente', 'correspond', 'signifie', 'implique',
    'démontre', 'prouve', 'permet', 'cause', 'entraîne', 'résulte',
    'montre', 'indique', 'suggère', 'confirme', 'révèle', 'favorise',
    'aide', 'améliore', 'réduit', 'augmente', 'consiste'
  ];

  const negations = ['n\'est pas', 'ne sont pas', 'n\'a pas', 'ne peut pas', 'jamais', 'aucun'];

  const sentences = splitSentences(text);
  return sentences
    .filter(s => {
      const hasMarker = markers.some(m => s.toLowerCase().includes(m));
      const hasNegation = negations.some(n => s.toLowerCase().includes(n));
      return hasMarker || hasNegation;
    })
    .slice(0, 20);
};

export const stringSimilarity = (str1: string, str2: string): number => {
  if (!str1 || !str2) return 0;
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  
  const editDistance = (s1: string, s2: string) => {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) costs[j] = j;
        else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  };
  
  return (longer.length - editDistance(longer, shorter)) / longer.length;
};

export const claimsSimilarity = (claim1: string, claim2: string): number => {
  if (!claim1 || !claim2) return 0;
  
  const words1 = new Set(claim1.toLowerCase().match(/\b\w{4,}\b/g) || []);
  const words2 = new Set(claim2.toLowerCase().match(/\b\w{4,}\b/g) || []);

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return union > 0 ? intersection / union : 0;
};