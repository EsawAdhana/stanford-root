// @ts-ignore - vader-sentiment doesn't have official types
import vader from 'vader-sentiment';

export interface SentimentResult {
    sentiment: 'positive' | 'negative' | 'neutral';
    score: number; // Normalized -1 to 1 (VADER's compound score)
    positiveWords: string[];
    negativeWords: string[];
}

/**
 * Professional sentiment analysis using VADER (Valence Aware Dictionary and sEntiment Reasoner).
 * It handles negations, intensifiers, and punctuation nuances natively.
 */
export function getCommentSentiment(text: string): SentimentResult {
    const result: SentimentResult = {
        sentiment: 'neutral',
        score: 0,
        positiveWords: [], // VADER doesn't return specific words easily, so we keep these empty for now
        negativeWords: []
    };

    if (!text || text.trim().length === 0) return result;

    try {
        const intensity = vader.SentimentIntensityAnalyzer.polarity_scores(text);
        const compound = intensity.compound;

        result.score = Math.round(compound * 100) / 100;

        // VADER standard thresholds:
        // positive: compound >= 0.05
        // neutral: -0.05 < compound < 0.05
        // negative: compound <= -0.05
        // However, for course evals, we might want slightly higher thresholds to avoid noise
        if (compound >= 0.1) {
            result.sentiment = 'positive';
        } else if (compound <= -0.1) {
            result.sentiment = 'negative';
        } else {
            result.sentiment = 'neutral';
        }
    } catch (error) {
        console.error('Sentiment analysis failed:', error);
    }

    return result;
}
