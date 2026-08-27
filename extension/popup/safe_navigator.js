/**
 * Safe Navigation & URL Extractor for Rakshak Browser Agent.
 * Parses natural language instructions for explicit website navigation requests,
 * validating destinations before performing standard HTTPS tab navigation.
 */

// Common top-level domains pattern
const TLD_PATTERN = /\.(com|org|net|edu|gov|io|ai|co|in|uk|de|jp|ca|app|dev|me|info|biz|tv|online|site|tech|xyz)\b/i;

// Curated lookup of common web services and websites
const KNOWN_DOMAINS = {
  'youtube': 'https://www.youtube.com',
  'youtube.com': 'https://www.youtube.com',
  'google': 'https://www.google.com',
  'google.com': 'https://www.google.com',
  'github': 'https://www.github.com',
  'github.com': 'https://www.github.com',
  'wikipedia': 'https://www.wikipedia.org',
  'wikipedia.org': 'https://www.wikipedia.org',
  'reddit': 'https://www.reddit.com',
  'reddit.com': 'https://www.reddit.com',
  'twitter': 'https://www.twitter.com',
  'twitter.com': 'https://www.twitter.com',
  'x': 'https://www.x.com',
  'x.com': 'https://www.x.com',
  'amazon': 'https://www.amazon.com',
  'amazon.com': 'https://www.amazon.com',
  'linkedin': 'https://www.linkedin.com',
  'linkedin.com': 'https://www.linkedin.com',
  'instagram': 'https://www.instagram.com',
  'instagram.com': 'https://www.instagram.com',
  'facebook': 'https://www.facebook.com',
  'facebook.com': 'https://www.facebook.com',
  'netflix': 'https://www.netflix.com',
  'netflix.com': 'https://www.netflix.com',
  'spotify': 'https://www.spotify.com',
  'spotify.com': 'https://www.spotify.com',
  'bing': 'https://www.bing.com',
  'bing.com': 'https://www.bing.com',
  'duckduckgo': 'https://www.duckduckgo.com',
  'duckduckgo.com': 'https://www.duckduckgo.com',
  'stackoverflow': 'https://www.stackoverflow.com',
  'stackoverflow.com': 'https://www.stackoverflow.com',
  'yahoo': 'https://www.yahoo.com',
  'yahoo.com': 'https://www.yahoo.com',
  'twitch': 'https://www.twitch.tv',
  'twitch.tv': 'https://www.twitch.tv',
  'openai': 'https://www.openai.com',
  'openai.com': 'https://www.openai.com',
  'chatgpt': 'https://chat.openai.com',
  'geeksforgeeks': 'https://www.geeksforgeeks.org',
  'geeksforgeeks.org': 'https://www.geeksforgeeks.org',
  'leetcode': 'https://www.leetcode.com',
  'leetcode.com': 'https://www.leetcode.com',
  'hackerrank': 'https://www.hackerrank.com',
  'hackerrank.com': 'https://www.hackerrank.com',
  'medium': 'https://www.medium.com',
  'medium.com': 'https://www.medium.com',
  'quora': 'https://www.quora.com',
  'quora.com': 'https://www.quora.com',
  'pinterest': 'https://www.pinterest.com',
  'pinterest.com': 'https://www.pinterest.com',
  'imdb': 'https://www.imdb.com',
  'imdb.com': 'https://www.imdb.com',
  'huggingface': 'https://www.huggingface.co',
  'huggingface.co': 'https://www.huggingface.co'
};

/**
 * Checks if a given URL is a restricted/internal browser page.
 * @param {string} url
 * @returns {boolean}
 */
export function isRestrictedPage(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith('chrome://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:') ||
    lower.startsWith('brave://') ||
    lower.startsWith('opera://') ||
    lower.startsWith('vivaldi://') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('data:') ||
    lower.startsWith('javascript:')
  );
}

/**
 * Validates whether a target destination URL is safe to navigate to.
 * Only http: and https: protocols are permitted.
 * Blocks all javascript:, data:, chrome:, file:, and internal schemes.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeDestinationUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('file:') ||
    trimmed.startsWith('chrome:') ||
    trimmed.startsWith('edge:') ||
    trimmed.startsWith('about:')
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

/**
 * Extracts a destination URL from a natural language user prompt if explicit navigation was requested.
 * Supports:
 * - "Open YouTube" -> "https://www.youtube.com"
 * - "Go to https://news.ycombinator.com" -> "https://news.ycombinator.com"
 * - "Navigate to github.com and find rakshak" -> "https://github.com"
 * - "Launch wikipedia and search Einstein" -> "https://www.wikipedia.org"
 * - "Search for Python tutorials" -> null (No navigation target in prompt, context-dependent)
 *
 * @param {string} taskPrompt
 * @returns {string|null} Destination URL or null if no explicit navigation requested
 */
export function extractNavigationGoal(taskPrompt) {
  if (!taskPrompt || typeof taskPrompt !== 'string') return null;
  const prompt = taskPrompt.trim();

  // Pattern: Explicit opening/navigation keywords
  // open / go to / navigate to / browse to / visit / launch / load
  const navKeywordMatch = prompt.match(/\b(?:open|go\s+to|navigate\s+to|browse\s+to|visit|launch|load)\s+([a-zA-Z0-9.:\/-]+)/i);

  if (!navKeywordMatch) {
    // Check if prompt begins directly with a URL or domain like "youtube.com" or "https://..."
    const directUrlMatch = prompt.match(/^(?:https?:\/\/)?([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+(?:\/[^\s]*)?)/i);
    if (directUrlMatch) {
      const candidate = directUrlMatch[0].trim();
      return formatValidHttpsUrl(candidate);
    }
    return null;
  }

  const rawTarget = navKeywordMatch[1].trim().replace(/[.,;!?]+$/, '');
  const lowerTarget = rawTarget.toLowerCase();

  // 1. Check known friendly service names (e.g. "youtube", "wikipedia.org", "github")
  if (KNOWN_DOMAINS[lowerTarget]) {
    return KNOWN_DOMAINS[lowerTarget];
  }

  // 2. Check if target has a known domain extension (e.g. "amazon.in", "docs.python.org")
  if (TLD_PATTERN.test(lowerTarget) || lowerTarget.startsWith('http://') || lowerTarget.startsWith('https://')) {
    return formatValidHttpsUrl(rawTarget);
  }

  // 3. Check if target is a simple single-word service name (e.g., "open cnn", "open bbc")
  if (/^[a-zA-Z0-9-]+$/.test(lowerTarget) && !['a', 'the', 'this', 'that', 'new', 'tab', 'page', 'browser'].includes(lowerTarget)) {
    // Treat as dot-com domain
    return `https://www.${lowerTarget}.com`;
  }

  return null;
}

/**
 * Normalizes a URL string to secure https format.
 * @param {string} urlStr
 * @returns {string|null}
 */
export function formatValidHttpsUrl(urlStr) {
  if (!urlStr) return null;
  let formatted = urlStr.trim();
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = `https://${formatted}`;
  }

  if (isSafeDestinationUrl(formatted)) {
    return formatted;
  }
  return null;
}
