export interface ResponseData {
  name: string;
  content: string;
  H: number; // Entropy
  C: number; // Coherence
  score: number; // LMC Score
}

export interface Settings {
  epsilon: number;
  similarityThreshold: number;
  minContentLength: number;
}

export interface Concept {
  word: string;
  tag: string | null;
  frequency: number;
}

export interface Claim {
  claim: string;
  support: number;
  ais: string[];
  confidence: number;
}

export interface Divergence {
  ai: string;
  concepts: string[];
  score: number;
}

export interface EmergentInsight {
  concept1: string;
  concept2: string;
  ai1: string;
  ai2: string;
  similarity: number;
  rarity1: number;
  rarity2: number;
}

export interface ConsensusData {
  concepts: string[];
  claims: Claim[];
  confidence: number;
}

export interface DebateData {
  agreements: Array<{
    claim1: string;
    claim2: string;
    similarity: number;
  }>;
  disagreements: Array<{
    claim: string;
    source: string;
    type: string;
  }>;
}

export interface Synthesis {
  timestamp: string;
  responses: Record<string, ResponseData>;
  consensus: ConsensusData;
  divergences: Divergence[];
  insights: Record<string, string[]>;
  emergentInsights: EmergentInsight[];
}

export interface HistoryItem {
  timestamp: string;
  synthesis: Synthesis;
  settings: Settings;
}

export type PresetType = 'academique' | 'creatif' | 'standard' | 'strict';