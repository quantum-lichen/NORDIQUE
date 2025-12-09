import React, { useState, useCallback, useMemo } from 'react';
import { Download, Copy, Brain, Zap, AlertCircle, TrendingUp, CheckCircle, BarChart3, Settings, Sword, Lightbulb, BookOpen, RefreshCw } from 'lucide-react';
import { ResponseData, Settings as SettingsType, Synthesis, HistoryItem, DebateData, PresetType } from '../types';
import { 
  calculateEntropy, 
  calculateCoherence, 
  calculateLMCScore, 
  extractClaims, 
  claimsSimilarity, 
  stringSimilarity 
} from '../utils/textProcessing';

export default function NordiqueLMC() {
  const [numWindows, setNumWindows] = useState(3);
  const [setupMode, setSetupMode] = useState(true);
  const [responses, setResponses] = useState<Record<string, ResponseData>>({});
  const [settings, setSettings] = useState<SettingsType>({
    epsilon: 0.1,
    similarityThreshold: 0.45,
    minContentLength: 100
  });
  
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'output' | 'debate' | 'history'>('input');
  const [showSettings, setShowSettings] = useState(false);
  const [calculationCache, setCalculationCache] = useState<Map<string, {H: number, C: number, score: number}>>(new Map());
  const [conceptTags, setConceptTags] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Préréglages LMC
  const presets: Record<PresetType, SettingsType> = {
    academique: { epsilon: 0.05, similarityThreshold: 0.5, minContentLength: 200 },
    creatif: { epsilon: 0.2, similarityThreshold: 0.4, minContentLength: 100 },
    standard: { epsilon: 0.1, similarityThreshold: 0.45, minContentLength: 100 },
    strict: { epsilon: 0.01, similarityThreshold: 0.6, minContentLength: 150 }
  };

  // ===== INITIALIZATION =====
  
  const initializeResponses = useCallback((count: number) => {
    const defaultNames = ['Claude', 'ChatGPT', 'Gemini', 'Perplexity', 'Llama', 'Mistral', 'GPT-4', 'Bard'];
    const newResponses: Record<string, ResponseData> = {};
    
    for (let i = 0; i < count; i++) {
      newResponses[`ai_${i}`] = {
        name: defaultNames[i] || `IA ${i + 1}`,
        content: '',
        H: 0,
        C: 0,
        score: 0
      };
    }
    
    setResponses(newResponses);
  }, []);

  // Charger un exemple
  const loadExample = useCallback(() => {
    const exampleResponses: Record<string, ResponseData> = {
      ai_0: {
        name: "Claude",
        content: "Pour soulager la toux, il est important de rester bien hydraté en buvant beaucoup de liquides chauds comme du thé ou du bouillon. Un humidificateur peut aider à humidifier les voies respiratoires. Le miel a des propriétés apaisantes naturelles. Le repos est essentiel pour permettre au corps de récupérer. Si la toux persiste plus de quelques jours ou s'accompagne de fièvre, il faut consulter un médecin.",
        H: 0,
        C: 0,
        score: 0
      },
      ai_1: {
        name: "ChatGPT",
        content: "Les remèdes pour calmer la toux incluent : boire des boissons chaudes (tisanes, eau tiède avec du miel et du citron), utiliser un humidificateur pour l'air sec, prendre des pastilles pour la gorge, et se reposer suffisamment. Évitez les irritants comme la fumée. Si la douleur persiste ou si vous êtes allergique à certains ingrédients, consultez un professionnel de santé. Pour les enfants, adaptez les dosages et évitez le miel avant 1 an.",
        H: 0,
        C: 0,
        score: 0
      },
      ai_2: {
        name: "Gemini",
        content: "Voici des astuces de grand-mère pour le confort : Le miel est un classique efficace, surtout avec du citron chaud. L'humidité combat l'air sec qui aggrave la toux. Dormir la tête surélevée aide à drainer. Les pastilles gardent la gorge humide. Important : si la toux persiste ou s'aggrave, consultez un médecin. Ces conseils ne remplacent pas l'avis d'un professionnel de santé.",
        H: 0,
        C: 0,
        score: 0
      }
    };
    setResponses(exampleResponses);
    setNumWindows(3);
    setSetupMode(false);
  }, []);

  // ===== EXTRACTION (Component Specific) =====
  
  const extractConcepts = useCallback((text: string) => {
    if (!text || text.length < 50) return [];
    
    const words = text.match(/\b[a-zàâäéèêëïîôöùûüœæç]{5,}\b/gi) || [];
    const stopwords = new Set([
      'cette', 'comme', 'dans', 'pour', 'avec', 'sont', 'leurs', 'plus', 'peut',
      'être', 'fait', 'permet', 'avoir', 'faire', 'entre', 'donc', 'aussi', 'ainsi',
      'selon', 'toute', 'tous', 'était', 'serait', 'pourrait', 'existe', 'autres',
      'chaque', 'peuvent', 'encore', 'toujours', 'quelque', 'certains', 'plusieurs',
      'parce', 'lorsque', 'quand', 'comment', 'pourquoi', 'avant', 'après', 'pendant',
      'celui', 'celle', 'leurs', 'autre', 'votre', 'notre', 'leurs', 'même', 'très'
    ]);

    const freq: Record<string, number> = {};
    words.forEach(w => {
      const normalized = w.toLowerCase();
      if (!stopwords.has(normalized)) {
        freq[normalized] = (freq[normalized] || 0) + 1;
      }
    });

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([word]) => ({
        word,
        tag: conceptTags[word] || null,
        frequency: freq[word]
      }));
  }, [conceptTags]);

  // ===== ANALYSE PRINCIPALE =====

  const findConsensus = useCallback(() => {
    const activeResponses = (Object.entries(responses) as [string, ResponseData][])
      .filter(([_, data]) => data.content.trim().length > settings.minContentLength)
      .map(([key, data]) => ({ key, ...data }));
    
    if (activeResponses.length < 2) {
      return { concepts: [], claims: [], confidence: 0 };
    }

    const conceptSets = activeResponses.map(resp => 
      new Set(extractConcepts(resp.content).map(c => c.word))
    );

    let commonConcepts = Array.from(conceptSets[0]);
    for (let i = 1; i < conceptSets.length; i++) {
      commonConcepts = commonConcepts.filter(c => conceptSets[i].has(c));
    }

    const allClaims: Array<{claim: string, ai: string, key: string}> = [];
    activeResponses.forEach(resp => {
      extractClaims(resp.content).forEach(claim => {
        allClaims.push({ claim, ai: resp.name, key: resp.key });
      });
    });

    const consensusClaims = [];
    const seen = new Set();

    for (let i = 0; i < allClaims.length; i++) {
      const claimNorm = allClaims[i].claim.toLowerCase().substring(0, 100);
      
      if (seen.has(claimNorm)) continue;
      seen.add(claimNorm);

      let supporters = [allClaims[i].ai];

      for (let j = i + 1; j < allClaims.length; j++) {
        if (claimsSimilarity(allClaims[i].claim, allClaims[j].claim) > settings.similarityThreshold) {
          if (!supporters.includes(allClaims[j].ai)) {
            supporters.push(allClaims[j].ai);
          }
        }
      }

      if (supporters.length >= 2) {
        consensusClaims.push({
          claim: allClaims[i].claim.substring(0, 250),
          support: supporters.length,
          ais: supporters,
          confidence: supporters.length / activeResponses.length
        });
      }
    }

    return {
      concepts: commonConcepts.slice(0, 25),
      claims: consensusClaims.sort((a, b) => b.confidence - a.confidence).slice(0, 12),
      confidence: commonConcepts.length > 0 ? commonConcepts.length / 40 : 0
    };
  }, [responses, settings, extractConcepts]);

  const findDivergences = useCallback(() => {
    const activeResponses = (Object.entries(responses) as [string, ResponseData][])
      .filter(([_, data]) => data.content.trim().length > settings.minContentLength)
      .map(([key, data]) => ({ key, ...data }));

    if (activeResponses.length < 2) return [];

    const divergences: Array<{ai: string, concepts: string[], score: number}> = [];

    activeResponses.forEach((resp, idx) => {
      const concepts = new Set(extractConcepts(resp.content).map(c => c.word));
      const otherConcepts = new Set();

      activeResponses.forEach((other, oidx) => {
        if (oidx !== idx) {
          extractConcepts(other.content).forEach(c => otherConcepts.add(c.word));
        }
      });

      const unique = [...concepts]
        .filter(c => !otherConcepts.has(c))
        .slice(0, 15);

      if (unique.length > 0) {
        divergences.push({
          ai: resp.name,
          concepts: unique,
          score: resp.score
        });
      }
    });

    return divergences;
  }, [responses, settings, extractConcepts]);

  const extractUniqueInsights = useCallback(() => {
    const activeResponses = (Object.entries(responses) as [string, ResponseData][])
      .filter(([_, data]) => data.content.trim().length > settings.minContentLength)
      .map(([key, data]) => ({ key, ...data }));

    if (activeResponses.length < 2) return {};

    const insights: Record<string, string[]> = {};

    activeResponses.forEach((resp, idx) => {
      const claims = extractClaims(resp.content);
      const uniqueClaims: string[] = [];

      claims.forEach(claim => {
        let isUnique = true;

        activeResponses.forEach((other, oidx) => {
          if (oidx === idx) return;
          
          extractClaims(other.content).forEach(otherClaim => {
            if (claimsSimilarity(claim, otherClaim) > 0.55) {
              isUnique = false;
            }
          });
        });

        if (isUnique) {
          uniqueClaims.push(claim.substring(0, 200));
        }
      });

      insights[resp.name] = uniqueClaims.slice(0, 5);
    });

    return insights;
  }, [responses, settings]);

  // ===== MODE DÉBAT =====
  
  const compareResponses = useCallback((resp1: ResponseData, resp2: ResponseData): DebateData => {
    const claims1 = extractClaims(resp1.content);
    const claims2 = extractClaims(resp2.content);

    const agreements: DebateData['agreements'] = [];
    const disagreements: DebateData['disagreements'] = [];

    claims1.forEach(claim1 => {
      const similarClaim = claims2.find(claim2 =>
        claimsSimilarity(claim1, claim2) > 0.6
      );
      if (similarClaim) {
        agreements.push({
          claim1,
          claim2: similarClaim,
          similarity: claimsSimilarity(claim1, similarClaim)
        });
      } else {
        disagreements.push({
          claim: claim1,
          source: resp1.name,
          type: 'unique'
        });
      }
    });

    claims2.forEach(claim2 => {
      if (!claims1.some(claim1 => claimsSimilarity(claim1, claim2) > 0.6)) {
        disagreements.push({
          claim: claim2,
          source: resp2.name,
          type: 'unique'
        });
      }
    });

    return { agreements, disagreements };
  }, []);

  // ===== INSIGHTS ÉMERGENTS AMÉLIORÉS =====
  
  const findEmergentInsights = useCallback(() => {
    const activeResponses = (Object.entries(responses) as [string, ResponseData][])
      .filter(([_, data]) => data.content.trim().length > settings.minContentLength)
      .map(([key, data]) => ({ key, ...data }));

    if (activeResponses.length < 2) return [];

    // Calculer la fréquence globale
    const globalConceptFreq: Record<string, number> = {};
    activeResponses.forEach(resp => {
      const concepts = extractConcepts(resp.content);
      concepts.forEach(c => {
        globalConceptFreq[c.word] = (globalConceptFreq[c.word] || 0) + 1;
      });
    });

    const insights = [];
    
    for (let i = 0; i < activeResponses.length; i++) {
      const ai1 = activeResponses[i].name;
      const concepts1 = extractConcepts(activeResponses[i].content);
      
      for (let j = i + 1; j < activeResponses.length; j++) {
        const ai2 = activeResponses[j].name;
        const concepts2 = extractConcepts(activeResponses[j].content);
        
        concepts1.forEach(c1 => {
          // Filtrer les concepts trop fréquents
          if (globalConceptFreq[c1.word] > 2) return;
          
          concepts2.forEach(c2 => {
            if (globalConceptFreq[c2.word] > 2) return;
            
            const similarity = stringSimilarity(c1.word, c2.word);
            // Seuil ajusté pour éviter faux positifs
            if (similarity > 0.65 && similarity < 0.92) {
              insights.push({
                concept1: c1.word,
                concept2: c2.word,
                ai1,
                ai2,
                similarity,
                rarity1: 1 / (globalConceptFreq[c1.word] || 1),
                rarity2: 1 / (globalConceptFreq[c2.word] || 1)
              });
            }
          });
        });
      }
    }

    // Trier par rareté et similarité
    return insights
      .sort((a, b) => (b.rarity1 + b.rarity2) - (a.rarity1 + a.rarity2))
      .slice(0, 10);
  }, [responses, settings, extractConcepts]);

  // ===== HANDLERS AVEC CACHE =====

  const handleSetupComplete = () => {
    initializeResponses(numWindows);
    setSetupMode(false);
  };

  const handleUpdateName = (key: string, name: string) => {
    setResponses(prev => ({
      ...prev,
      [key]: { ...prev[key], name: name.substring(0, 30) }
    }));
  };

  const handleUpdateContent = useCallback((key: string, content: string) => {
    const trimmedContent = content.substring(0, 150000);
    
    setResponses(prev => {
      const updated = { ...prev, [key]: { ...prev[key], content: trimmedContent } };

      // Cache optimisé
      if (trimmedContent.length > settings.minContentLength) {
        const cacheKey = `${key}:${trimmedContent.substring(0, 50)}:${trimmedContent.length}`;
        
        if (!calculationCache.has(cacheKey)) {
          const H = calculateEntropy(trimmedContent);
          const C = calculateCoherence(trimmedContent);
          const score = calculateLMCScore(H, C, settings.epsilon);
          
          const newCache = new Map(calculationCache);
          newCache.set(cacheKey, { H, C, score });
          setCalculationCache(newCache);
          
          updated[key] = { ...updated[key], H, C, score };
        } else {
          const cached = calculationCache.get(cacheKey);
          if (cached) {
            updated[key] = { ...updated[key], ...cached };
          }
        }
      }
      
      return updated;
    });
  }, [calculationCache, settings.minContentLength, settings.epsilon]);

  const handleSynthesize = async () => {
    try {
      setLoading(true);
      
      const activeCount = Object.values(responses)
        .filter((r) => (r as ResponseData).content.trim().length > settings.minContentLength).length;

      if (activeCount < 2) {
        alert(`❌ Minimum 2 réponses nécessaires (>${settings.minContentLength} caractères)`);
        setLoading(false);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 1200));

      const updatedResponses: Record<string, ResponseData> = {};
      (Object.entries(responses) as [string, ResponseData][]).forEach(([key, data]) => {
        if (data.content.trim().length > settings.minContentLength) {
          const H = calculateEntropy(data.content);
          const C = calculateCoherence(data.content);
          const score = calculateLMCScore(H, C, settings.epsilon);
          updatedResponses[key] = { ...data, H, C, score };
        } else {
          updatedResponses[key] = data;
        }
      });

      setResponses(updatedResponses);

      const consensus = findConsensus();
      const divergences = findDivergences();
      const insights = extractUniqueInsights();
      const emergentInsights = findEmergentInsights();

      const newSynthesis: Synthesis = {
        timestamp: new Date().toISOString(),
        responses: updatedResponses,
        consensus,
        divergences,
        insights,
        emergentInsights
      };

      setSynthesis(newSynthesis);

      // Sauvegarder dans l'historique
      setHistory(prev => [
        {
          timestamp: newSynthesis.timestamp,
          synthesis: newSynthesis,
          settings: { ...settings }
        },
        ...prev.slice(0, 4)
      ]);

      setActiveTab('output');
      setLoading(false);
    } catch (err: any) {
      alert(`Erreur: ${err.message}`);
      setLoading(false);
    }
  };

  const toggleConceptTag = (word: string) => {
    setConceptTags(prev => {
      const current = prev[word];
      const newTags = { ...prev };
      
      if (!current) newTags[word] = 'important';
      else if (current === 'important') newTags[word] = 'verify';
      else delete newTags[word];
      
      return newTags;
    });
  };

  const generateMarkdown = () => {
    if (!synthesis) return '';

    let md = '# ❄️ NORDIQUE REPORT (LMC)\n\n';
    md += `**Synthétisé le:** ${new Date(synthesis.timestamp).toLocaleString('fr-FR')}\n`;
    md += `**Sources Analysées:** ${Object.values(synthesis.responses).filter(r => r.content.length > settings.minContentLength).length}\n`;
    md += `**Paramètres:** ε=${settings.epsilon}, Seuil=${settings.similarityThreshold}\n\n`;
    md += '---\n\n';

    md += '## 📊 SCORES LMC\n\n';
    (Object.entries(synthesis.responses) as [string, ResponseData][])
      .filter(([_, data]) => data.content.length > settings.minContentLength)
      .sort((a, b) => b[1].score - a[1].score)
      .forEach(([key, data]) => {
        md += `**${data.name}:** Score = ${data.score.toFixed(2)} (H=${data.H.toFixed(2)}, C=${data.C.toFixed(2)})\n`;
      });
    md += '\n---\n\n';

    md += '## ✅ CONSENSUS\n\n';
    if (synthesis.consensus.claims.length > 0) {
      synthesis.consensus.claims.forEach(claim => {
        md += `- **[${Math.round(claim.confidence * 100)}% | ${claim.ais.join(', ')}]** ${claim.claim}\n`;
      });
    } else {
      md += '*Pas de consensus détecté.*\n';
    }

    if (synthesis.consensus.concepts.length > 0) {
      md += '\n### Concepts Communs:\n';
      md += synthesis.consensus.concepts.map(c => `\`${c}\``).join(', ');
      md += '\n';
    }

    md += '\n---\n\n## 💡 INSIGHTS UNIQUES\n\n';
    Object.entries(synthesis.insights).forEach(([ai, claims]) => {
      if (claims.length > 0) {
        md += `### ${ai}:\n`;
        claims.forEach(c => md += `- ${c}\n`);
        md += '\n';
      }
    });

    md += '---\n\n## 🔥 DIVERGENCES\n\n';
    synthesis.divergences.forEach(div => {
      md += `**${div.ai}:** ${div.concepts.join(', ')}\n\n`;
    });

    if (synthesis.emergentInsights && synthesis.emergentInsights.length > 0) {
      md += '---\n\n## 💡 INSIGHTS ÉMERGENTS\n\n';
      synthesis.emergentInsights.forEach(insight => {
        md += `- **${insight.ai1}** ("${insight.concept1}") ↔ **${insight.ai2}** ("${insight.concept2}") — ${Math.round(insight.similarity * 100)}%\n`;
      });
      md += '\n';
    }

    md += '\n---\n*NORDIQUE | Propulsé par LMC (Least Model Complexity)*\n';
    return md;
  };

  const downloadMarkdown = () => {
    const md = generateMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nordique_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMarkdown = () => {
    navigator.clipboard.writeText(generateMarkdown());
    alert('✅ Rapport copié!');
  };

  const debateData = useMemo<DebateData | null>(() => {
    if (!synthesis) return null;
    const activeResponses = (Object.entries(responses) as [string, ResponseData][])
      .filter(([_, data]) => data.content.trim().length > settings.minContentLength)
      .map(([key, data]) => ({ key, ...data }));
    
    if (activeResponses.length < 2) return null;
    
    return compareResponses(activeResponses[0], activeResponses[1]);
  }, [synthesis, responses, settings, compareResponses]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-700 to-blue-900 p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* HEADER */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="text-6xl">❄️</div>
            <h1 className="text-5xl font-black text-white">
              NORDIQUE
            </h1>
            <div className="text-6xl">❄️</div>
          </div>
          <p className="text-blue-200 text-xl mb-2">Synthèse Multi-IA par LMC</p>
          <p className="text-blue-300 text-sm">(Least Model Complexity Theory)</p>
        </div>

        {/* SETUP MODE */}
        {setupMode && (
          <div className="mb-8 p-8 bg-white/95 rounded-xl shadow-2xl border-4 border-blue-800">
            <div className="flex items-center justify-center gap-3 mb-6">
              <Settings className="w-8 h-8 text-blue-900" />
              <h2 className="text-3xl font-bold text-blue-900">Configuration</h2>
            </div>
            
            <div className="mb-6">
              <p className="text-gray-700 font-bold mb-4">Nombre d'IA à analyser:</p>
              <div className="flex gap-3 justify-center flex-wrap">
                {[2, 3, 4, 5, 6, 7, 8].map(n => (
                  <button
                    key={n}
                    onClick={() => setNumWindows(n)}
                    className={`px-6 py-3 rounded-lg font-bold transition ${
                      numWindows === n
                        ? 'bg-blue-900 text-white scale-110'
                        : 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleSetupComplete}
                className="px-8 py-4 bg-blue-900 text-white font-black text-xl rounded-lg hover:bg-blue-800 transition"
              >
                ✓ Commencer l'Analyse
              </button>
              <button
                onClick={loadExample}
                className="px-8 py-4 bg-green-600 text-white font-black text-xl rounded-lg hover:bg-green-500 transition flex items-center justify-center gap-2"
              >
                <BookOpen className="w-6 h-6" />
                📖 Charger Exemple
              </button>
            </div>
          </div>
        )}

        {/* SETTINGS PANEL */}
        {!setupMode && showSettings && (
          <div className="mb-8 p-6 bg-white/95 rounded-xl shadow-2xl border-4 border-blue-800">
            <h3 className="font-bold text-xl mb-4 text-blue-900">⚙️ Paramètres LMC Avancés</h3>
            
            {/* Préréglages */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2 text-gray-700">Préréglages rapides:</label>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(presets).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => setSettings(preset)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                      JSON.stringify(settings) === JSON.stringify(preset)
                        ? 'bg-blue-900 text-white'
                        : 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                    }`}
                  >
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">Epsilon (ε)</label>
                <input
                  type="range"
                  min="0.01"
                  max="0.5"
                  step="0.01"
                  value={settings.epsilon}
                  onChange={(e) => setSettings({...settings, epsilon: parseFloat(e.target.value)})}
                  className="w-full"
                />
                <span className="text-sm text-gray-600">{settings.epsilon.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">Seuil de Similarité</label>
                <input
                  type="range"
                  min="0.3"
                  max="0.9"
                  step="0.05"
                  value={settings.similarityThreshold}
                  onChange={(e) => setSettings({...settings, similarityThreshold: parseFloat(e.target.value)})}
                  className="w-full"
                />
                <span className="text-sm text-gray-600">{settings.similarityThreshold.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">Taille Min. (chars)</label>
                <input
                  type="number"
                  min="50"
                  max="1000"
                  step="50"
                  value={settings.minContentLength}
                  onChange={(e) => setSettings({...settings, minContentLength: parseInt(e.target.value)})}
                  className="w-full px-3 py-2 border-2 border-blue-300 rounded-lg"
                />
              </div>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="mt-4 px-6 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800"
            >
              Fermer
            </button>
          </div>
        )}

        {!setupMode && (
          <>
            {/* TABS */}
            <div className="flex gap-3 mb-8 justify-center flex-wrap">
              <button
                onClick={() => setActiveTab('input')}
                className={`px-6 py-3 rounded-lg font-bold transition ${
                  activeTab === 'input'
                    ? 'bg-white text-blue-900'
                    : 'bg-blue-800 text-white hover:bg-blue-700'
                }`}
              >
                📝 Entrées ({numWindows})
              </button>
              {synthesis && (
                <>
                  <button
                    onClick={() => setActiveTab('output')}
                    className={`px-6 py-3 rounded-lg font-bold transition ${
                      activeTab === 'output'
                        ? 'bg-white text-blue-900'
                        : 'bg-blue-800 text-white hover:bg-blue-700'
                    }`}
                  >
                    📊 Résultats
                  </button>
                  <button
                    onClick={() => setActiveTab('debate')}
                    className={`px-6 py-3 rounded-lg font-bold transition ${
                      activeTab === 'debate'
                        ? 'bg-white text-blue-900'
                        : 'bg-blue-800 text-white hover:bg-blue-700'
                    }`}
                  >
                    ⚔️ Débat
                  </button>
                  {history.length > 0 && (
                    <button
                      onClick={() => setActiveTab('history')}
                      className={`px-6 py-3 rounded-lg font-bold transition ${
                        activeTab === 'history'
                          ? 'bg-white text-blue-900'
                          : 'bg-blue-800 text-white hover:bg-blue-700'
                      }`}
                    >
                      🕰️ Historique ({history.length})
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="px-6 py-3 rounded-lg font-bold bg-blue-700 text-white hover:bg-blue-600 transition"
              >
                ⚙️
              </button>
              <button
                onClick={() => {
                  setSetupMode(true);
                  setSynthesis(null);
                }}
                className="px-6 py-3 rounded-lg font-bold bg-blue-600 text-white hover:bg-blue-500 transition"
              >
                🔄 Reconfigurer
              </button>
            </div>

            {/* INPUT TAB */}
            {activeTab === 'input' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {(Object.entries(responses) as [string, ResponseData][]).map(([key, data]) => (
                    <div
                      key={key}
                      className="bg-white/95 backdrop-blur rounded-xl p-6 shadow-2xl border-4 border-blue-800"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <Brain className="w-6 h-6 text-blue-900" />
                        <input
                          type="text"
                          value={data.name}
                          onChange={(e) => handleUpdateName(key, e.target.value)}
                          className="flex-1 bg-blue-50 border-2 border-blue-300 rounded-lg px-3 py-2 text-blue-900 font-bold focus:border-blue-600 focus:outline-none"
                          placeholder="Nom de l'IA"
                          maxLength={30}
                        />
                      </div>
                      
                      <textarea
                        value={data.content}
                        onChange={(e) => handleUpdateContent(key, e.target.value)}
                        placeholder={`Colle la réponse de ${data.name}... (Max 150k caractères)`}
                        className="w-full bg-blue-50 border-2 border-blue-300 rounded-lg p-4 text-gray-800 placeholder-gray-500 focus:border-blue-600 focus:outline-none resize-none text-sm"
                        style={{ minHeight: '350px' }}
                        maxLength={150000}
                      />
                      
                      <div className="mt-3 flex justify-between text-sm text-gray-600">
                        <span>{data.content.length.toLocaleString()} / 150,000</span>
                        {data.score > 0 && (
                          <span className="font-bold text-blue-700">
                            LMC: {data.score.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-center">
                  <button
                    onClick={handleSynthesize}
                    disabled={loading}
                    className="flex items-center gap-3 px-10 py-4 bg-white text-blue-900 font-black text-xl rounded-xl hover:shadow-2xl transition disabled:opacity-50 disabled:cursor-not-allowed border-4 border-blue-800"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin">⚙️</div>
                        Analyse LMC...
                      </>
                    ) : (
                      <>
                        <Zap className="w-7 h-7" />
                        ❄️ SYNTHÉTISER
                      </>
                    )}
                  </button>
                </div>
              </>
            )}

            {/* OUTPUT TAB */}
            {activeTab === 'output' && synthesis && (
              <div className="space-y-8">
                
                {/* SCORES LMC */}
                <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                  <h2 className="text-3xl font-bold text-blue-900 mb-6 flex items-center gap-3">
                    <BarChart3 className="w-8 h-8" />
                    📊 Scores LMC
                  </h2>

                  <div className="space-y-4">
                    {(Object.entries(synthesis.responses) as [string, ResponseData][])
                      .filter(([_, data]) => data.content.length > settings.minContentLength)
                      .sort((a, b) => b[1].score - a[1].score)
                      .map(([key, data]) => (
                        <div key={key} className="bg-blue-50 rounded-lg p-4 border-2 border-blue-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-blue-900 text-lg">{data.name}</span>
                            <span className="text-2xl font-black text-blue-700">{data.score.toFixed(2)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-600">Entropie (H):</span>
                              <span className="ml-2 font-bold text-gray-800">{data.H.toFixed(3)}</span>
                            </div>
                            <div>
                              <span className="text-gray-600">Cohérence (C):</span>
                              <span className="ml-2 font-bold text-gray-800">{data.C.toFixed(3)}</span>
                            </div>
                          </div>
                          <div className="mt-2 bg-blue-200 rounded-full h-3 overflow-hidden">
                            <div 
                              className="bg-blue-600 h-full transition-all duration-500"
                              style={{ width: `${Math.min(data.score * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>

                  <div className="mt-6 p-4 bg-blue-100 rounded-lg border-2 border-blue-300">
                    <p className="text-sm text-blue-900">
                      <strong>Formule LMC:</strong> Score = C / (H + ε) où C = Cohérence, H = Entropie, ε = {settings.epsilon}
                    </p>
                  </div>
                </div>

                {/* CONSENSUS */}
                <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                  <h2 className="text-3xl font-bold text-green-700 mb-6 flex items-center gap-3">
                    <CheckCircle className="w-8 h-8" />
                    ✅ CONSENSUS ({synthesis.consensus.claims.length})
                  </h2>

                  {synthesis.consensus.claims.length > 0 ? (
                    <div className="space-y-4">
                      {synthesis.consensus.claims.map((claim, i) => (
                        <div key={i} className="bg-green-50 rounded-lg p-4 border-2 border-green-200">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-3 py-1 bg-green-200 text-green-800 rounded-full text-sm font-bold">
                              {Math.round(claim.confidence * 100)}%
                            </span>
                            <span className="text-sm text-gray-600">
                              {claim.ais.join(', ')}
                            </span>
                          </div>
                          <p className="text-gray-800">{claim.claim}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-600 italic">Pas de consensus détecté.</p>
                  )}

                  {synthesis.consensus.concepts.length > 0 && (
                    <div className="mt-6 pt-6 border-t-2 border-green-200">
                      <p className="text-gray-700 font-bold mb-3">Concepts communs (cliquez pour taguer):</p>
                      <div className="flex flex-wrap gap-2">
                        {synthesis.consensus.concepts.map((c, i) => {
                          const tag = conceptTags[c];
                          return (
                            <span
                              key={i}
                              onClick={() => toggleConceptTag(c)}
                              className={`px-3 py-1 rounded-full text-sm font-medium cursor-pointer transition ${
                                tag === 'important' ? 'bg-red-200 text-red-800 ring-2 ring-red-400' :
                                tag === 'verify' ? 'bg-yellow-200 text-yellow-800 ring-2 ring-yellow-400' :
                                'bg-green-200 text-green-800 hover:bg-green-300'
                              }`}
                              title={tag === 'important' ? 'Important' : tag === 'verify' ? 'À vérifier' : 'Cliquez pour taguer'}
                            >
                              {tag === 'important' && '⭐ '}
                              {tag === 'verify' && '❓ '}
                              {c}
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        💡 Cliquez sur un concept : Sans tag → ⭐ Important → ❓ À vérifier → Sans tag
                      </p>
                    </div>
                  )}
                </div>

                {/* INSIGHTS UNIQUES */}
                <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                  <h2 className="text-3xl font-bold text-purple-700 mb-6 flex items-center gap-3">
                    <TrendingUp className="w-8 h-8" />
                    💡 INSIGHTS UNIQUES
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(synthesis.insights).map(([ai, claims]) =>
                      claims.length > 0 ? (
                        <div key={ai} className="bg-purple-50 rounded-lg p-4 border-2 border-purple-200">
                          <h3 className="text-purple-900 font-bold mb-3 text-lg">{ai}</h3>
                          <ul className="space-y-2">
                            {claims.map((claim, i) => (
                              <li key={i} className="text-gray-700 text-sm">• {claim}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null
                    )}
                  </div>
                </div>

                {/* INSIGHTS ÉMERGENTS */}
                {synthesis.emergentInsights && synthesis.emergentInsights.length > 0 && (
                  <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                    <h2 className="text-3xl font-bold text-cyan-700 mb-6 flex items-center gap-3">
                      <Lightbulb className="w-8 h-8" />
                      💡 INSIGHTS ÉMERGENTS
                    </h2>
                    <p className="text-sm text-gray-600 mb-4">
                      Concepts similaires entre différentes IA (filtrés par rareté et pertinence)
                    </p>
                    <div className="space-y-4">
                      {synthesis.emergentInsights.map((insight, i) => (
                        <div key={i} className="bg-cyan-50 rounded-lg p-4 border-l-4 border-cyan-500">
                          <p className="font-bold text-cyan-900">
                            {insight.ai1} ("{insight.concept1}") ↔ {insight.ai2} ("{insight.concept2}")
                          </p>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-sm text-gray-600">
                              Similarité: {Math.round(insight.similarity * 100)}%
                            </span>
                            <span className="text-xs text-gray-500">
                              Rareté: {((insight.rarity1 + insight.rarity2) / 2).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* DIVERGENCES */}
                <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                  <h2 className="text-3xl font-bold text-orange-700 mb-6 flex items-center gap-3">
                    <AlertCircle className="w-8 h-8" />
                    🔥 DIVERGENCES ({synthesis.divergences.length})
                  </h2>

                  <div className="space-y-4">
                    {synthesis.divergences.map((div, i) => (
                      <div key={i} className="bg-orange-50 rounded-lg p-4 border-2 border-orange-200">
                        <h3 className="text-orange-900 font-bold mb-2 text-lg flex items-center justify-between">
                          <span>{div.ai}</span>
                          <span className="text-sm font-normal text-gray-600">Score LMC: {div.score.toFixed(2)}</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {div.concepts.map((c, j) => (
                            <span key={j} className="bg-orange-200 text-orange-800 px-2 py-1 rounded text-sm font-medium">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ACTIONS */}
                <div className="bg-white/95 rounded-xl p-6 shadow-2xl border-4 border-blue-800">
                  <div className="flex gap-4 justify-center flex-wrap">
                    <button
                      onClick={downloadMarkdown}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-900 text-white font-bold rounded-lg hover:bg-blue-800 transition"
                    >
                      <Download className="w-5 h-5" />
                      Télécharger .md
                    </button>
                    <button
                      onClick={copyMarkdown}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-700 text-white font-bold rounded-lg hover:bg-blue-600 transition"
                    >
                      <Copy className="w-5 h-5" />
                      Copier
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('input');
                        setSynthesis(null);
                      }}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-400 transition"
                    >
                      Nouvelle Analyse
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* DEBATE TAB */}
            {activeTab === 'debate' && synthesis && debateData && (
              <div className="space-y-8">
                <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                  <h2 className="text-3xl font-bold text-purple-700 mb-6 flex items-center gap-3">
                    <Sword className="w-8 h-8" />
                    ⚔️ MODE DÉBAT
                  </h2>
                  <p className="text-sm text-gray-600 mb-6">
                    Comparaison des 2 premières IA analysées
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="font-bold text-xl mb-4 text-green-700">✅ Points d'Accord ({debateData.agreements.length})</h3>
                      <div className="space-y-4 max-h-96 overflow-y-auto">
                        {debateData.agreements.slice(0, 10).map((a, i) => (
                          <div key={i} className="bg-green-50 p-4 rounded-lg border-2 border-green-200">
                            <p className="text-sm font-bold text-gray-800">{a.claim1}</p>
                            <p className="text-xs text-gray-600 mt-2">≈ {a.claim2}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 bg-green-200 rounded-full h-2">
                                <div 
                                  className="bg-green-600 h-2 rounded-full transition-all duration-500"
                                  style={{ width: `${a.similarity * 100}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{Math.round(a.similarity * 100)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-bold text-xl mb-4 text-red-700">❌ Désaccords ({debateData.disagreements.length})</h3>
                      <div className="space-y-4 max-h-96 overflow-y-auto">
                        {debateData.disagreements.slice(0, 10).map((d, i) => (
                          <div key={i} className="bg-red-50 p-4 rounded-lg border-2 border-red-200">
                            <p className="text-sm text-gray-800">{d.claim}</p>
                            <p className="text-xs text-gray-600 mt-2 font-bold">
                              Source: {d.source}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* HISTORY TAB */}
            {activeTab === 'history' && history.length > 0 && (
              <div className="space-y-8">
                <div className="bg-white/95 rounded-xl p-8 shadow-2xl border-4 border-blue-800">
                  <h2 className="text-3xl font-bold text-blue-900 mb-6 flex items-center gap-3">
                    <RefreshCw className="w-8 h-8" />
                    🕰️ HISTORIQUE DES SYNTHÈSES
                  </h2>
                  <p className="text-sm text-gray-600 mb-6">
                    Les 5 dernières analyses sauvegardées
                  </p>
                  
                  <div className="space-y-6">
                    {history.map((item, i) => (
                      <div key={i} className="bg-blue-50 rounded-lg p-6 border-2 border-blue-200">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold text-lg text-blue-900">
                            Synthèse #{history.length - i}
                          </h3>
                          <span className="text-sm text-gray-600">
                            {new Date(item.timestamp).toLocaleString('fr-FR')}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                          <div>
                            <span className="text-gray-600">Epsilon:</span>
                            <span className="ml-2 font-bold text-gray-800">{item.settings.epsilon}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Seuil:</span>
                            <span className="ml-2 font-bold text-gray-800">{item.settings.similarityThreshold}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Consensus:</span>
                            <span className="ml-2 font-bold text-gray-800">{item.synthesis.consensus.claims.length}</span>
                          </div>
                        </div>
                        
                        <div className="bg-white p-4 rounded-lg">
                          <h4 className="font-bold mb-2 text-sm text-gray-700">Top 3 Consensus:</h4>
                          {item.synthesis.consensus.claims.slice(0, 3).map((claim, j) => (
                            <p key={j} className="text-xs text-gray-600 mb-1">
                              • [{Math.round(claim.confidence * 100)}%] {claim.claim.substring(0, 80)}...
                            </p>
                          ))}
                        </div>
                        
                        <button
                          onClick={() => {
                            setSynthesis(item.synthesis);
                            setSettings(item.settings);
                            setActiveTab('output');
                          }}
                          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition text-sm"
                        >
                          📊 Voir cette synthèse
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}