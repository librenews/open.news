/**
 * Utility to split long articles into overlapping text chunks suitable for embedding models.
 */

export interface ChunkOptions {
  maxWords?: number;
  overlapWords?: number;
}

export function chunkText(text: string, options?: ChunkOptions): string[] {
  const maxWords = options?.maxWords ?? 300; // Aiming for roughly ~400 tokens max
  const overlapWords = options?.overlapWords ?? 50;
  
  if (!text || text.trim().length === 0) return [];
  
  // Very simplistic word-boundary chunking
  // A robust implementation might use an actual tokenizer (like tiktoken) 
  // but splitting by whitespace is sufficient for approximate sizes.
  const words = text.split(/\s+/);
  
  if (words.length <= maxWords) {
    return [text];
  }
  
  const chunks: string[] = [];
  let i = 0;
  
  while (i < words.length) {
    const chunkWords = words.slice(i, i + maxWords);
    chunks.push(chunkWords.join(' '));
    
    // Move index forward by maxWords minus overlap
    i += (maxWords - overlapWords);
  }
  
  return chunks;
}
