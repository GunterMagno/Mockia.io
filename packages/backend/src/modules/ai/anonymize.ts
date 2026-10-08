/**
 * Removes from a stored PROMPT the structured fields that say which repository, owner and project it was built from
 * (modules/ai/prompt.service.ts writes them in a fixed format). Pure and idempotent; used by the dataset exporter before
 * the secret redaction and before hashing, so identical prompts from different repositories deduplicate.
 *
 * Removed, with stable placeholders:
 *  - the repository header block (`## Repository: ...`, `URL: ...`, `Owner: ...`, `Branch: ...`)
 *  - the project name and description of a prompt without repository (`## Project: ...` / `Description: ...` and the
 *    `Project Name ("...") and Description ("...")` sentence of the task part)
 *  - any `github.com|gitlab.com|bitbucket.org|codeberg.org/<owner>[/<repo>]` URL, including `git@host:owner/repo`
 *
 * NOT removed (and not claimed to be): names of people, companies or products typed inside README text or inside the
 * user's own requirement, and the repository name when it is merely mentioned in free text. The tests build real prompts
 * with buildPromptFromInput, so a change of its format that would reintroduce an identifier fails them.
 */

export const REDACTED_REPO = '[REDACTED_REPO]';
export const REDACTED_OWNER = '[REDACTED_OWNER]';
export const REDACTED_BRANCH = '[REDACTED_BRANCH]';
export const REDACTED_PROJECT = '[REDACTED_PROJECT]';
export const REDACTED_DESCRIPTION = '[REDACTED_DESCRIPTION]';

// `## Repository: x` + `URL: x` + `Owner: x` [+ `Branch: x`], consecutive lines exactly as formatGitHubContext writes them
const REPO_BLOCK = /^## Repository: .*\nURL: .*\nOwner: .*(?:\nBranch: .*)?/gm;

// No repository: `## Project: <title>\nDescription: <description, may span lines>\nNo GitHub context available yet.`
const PROJECT_BLOCK = /^## Project: .*\nDescription: [\s\S]*?\n(No GitHub context available yet\.)/gm;

// The task part without repository: `Project Name ("<title>") and Description ("<description>"), generate a beautiful`
const PROJECT_SENTENCE = /Project Name \("[\s\S]*?"\) and Description \("[\s\S]*?"\), generate a beautiful/g;

// A repository or profile URL on a well known code host (scheme, `www.` and `.git` optional; also scp-style `git@host:o/r`)
const REPO_URL =
  /(?:(?:https?|ssh|git):\/\/(?:git@)?|git@)?(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)[/:][A-Za-z0-9_.-]{1,100}(?:\/[A-Za-z0-9_.-]{1,100})?/g;

/** Replaces the repository/owner/project identifiers of a prompt message. */
export function anonymizePromptIdentifiers(text: string): string {
  if (!text) return text;
  let out = text.replace(
    REPO_BLOCK,
    (block) =>
      `## Repository: ${REDACTED_REPO}\nURL: ${REDACTED_REPO}\nOwner: ${REDACTED_OWNER}` +
      (/\nBranch: /.test(block) ? `\nBranch: ${REDACTED_BRANCH}` : '')
  );
  out = out.replace(PROJECT_BLOCK, (_m, tail: string) => `## Project: ${REDACTED_PROJECT}\nDescription: ${REDACTED_DESCRIPTION}\n${tail}`);
  out = out.replace(PROJECT_SENTENCE, `Project Name ("${REDACTED_PROJECT}") and Description ("${REDACTED_DESCRIPTION}"), generate a beautiful`);
  out = out.replace(REPO_URL, REDACTED_REPO);
  return out;
}
