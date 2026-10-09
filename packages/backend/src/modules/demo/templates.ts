import type { PromptInput } from '../ai/prompt.service.js';

/**
 * The three starting points of the demo, as small static prompt inputs. They are code, not data: a visitor can only pick
 * one by id, never send their own template, so nothing in them depends on user input.
 */

export const DEMO_TEMPLATE_IDS = ['shop', 'blog', 'users'] as const;
export type DemoTemplateId = (typeof DEMO_TEMPLATE_IDS)[number];

export const DEMO_TEMPLATES: Record<DemoTemplateId, PromptInput> = {
  shop: {
    projectTitle: 'Online shop',
    projectDescription: 'A small online shop with a product catalogue, a shopping cart and orders.',
    userInput:
      'Products (list, detail, create), a cart a customer can add items to, and orders a customer can place and look up. ' +
      'Use realistic product names, prices in USD and ISO dates.',
  },
  blog: {
    projectTitle: 'Blog',
    projectDescription: 'A personal blog with posts, authors and reader comments.',
    userInput:
      'Posts (list with pagination fields, detail by slug, create), the author of each post, and the comments on a post. ' +
      'Use realistic titles, short excerpts and ISO dates.',
  },
  users: {
    projectTitle: 'User directory',
    projectDescription: 'A user directory with accounts, profiles and roles.',
    userInput:
      'Users (list, detail, create, update, delete) with name, email, role and status, and a profile for each user. ' +
      'Use realistic but obviously fictional people and ISO dates.',
  },
};
