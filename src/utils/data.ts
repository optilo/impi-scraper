/**
 * Data utility functions
 */

/**
 * Parse date from DD/MM/YYYY or D/M/YYYY to YYYY-MM-DD format
 */
export function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  try {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;

    const day = parts[0]!.padStart(2, '0');
    const month = parts[1]!.padStart(2, '0');
    const year = parts[2]!;

    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Sanitize filename for safe file system usage
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*.,;()[\]{}]/g, '') // Remove invalid chars
    .replace(/\s+/g, '_') // Replace spaces
    .replace(/[^\x00-\x7F]/g, (char) => {
      const replacements: Record<string, string> = {
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
        'ñ': 'n', 'Ñ': 'N'
      };
      return replacements[char] || char;
    })
    .replace(/_+/g, '_') // Replace multiple underscores
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .substring(0, 200); // Limit length
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
