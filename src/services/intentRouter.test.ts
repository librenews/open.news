import { describe, it, expect } from 'vitest';
import { classifyIntent } from './intentRouter.js';

describe('classifyIntent', () => {
  // ── Greeting ────────────────────────────────────────────────────────────────
  it('classifies "Hello" as greeting', () => {
    expect(classifyIntent('Hello')).toBe('greeting');
  });

  it('classifies "hi" as greeting', () => {
    expect(classifyIntent('hi')).toBe('greeting');
  });

  it('classifies "hey there" as greeting', () => {
    expect(classifyIntent('hey there')).toBe('greeting');
  });

  it('classifies "Thanks!" as greeting', () => {
    expect(classifyIntent('Thanks!')).toBe('greeting');
  });

  it('classifies "thank you" as greeting', () => {
    expect(classifyIntent('thank you')).toBe('greeting');
  });

  // ── Mute domain ─────────────────────────────────────────────────────────────
  it('classifies "mute nytimes.com" as mute_domain', () => {
    expect(classifyIntent('mute nytimes.com')).toBe('mute_domain');
  });

  it('classifies "don\'t show me stuff from this site" as mute_domain', () => {
    expect(classifyIntent("don't show me stuff from this site")).toBe('mute_domain');
  });

  it('classifies "block CNN" as mute_domain', () => {
    expect(classifyIntent('block CNN')).toBe('mute_domain');
  });

  it('classifies "hide this source" as mute_domain', () => {
    expect(classifyIntent('hide this source')).toBe('mute_domain');
  });

  it('classifies "exclude this domain" as mute_domain', () => {
    expect(classifyIntent('exclude this domain')).toBe('mute_domain');
  });

  // ── Topic filter ────────────────────────────────────────────────────────────
  it('classifies "only show me tech news" as topic_filter', () => {
    expect(classifyIntent('only show me tech news')).toBe('topic_filter');
  });

  it('classifies "filter to politics" as topic_filter', () => {
    expect(classifyIntent('filter to politics')).toBe('topic_filter');
  });

  it('classifies "just show me sports" as topic_filter', () => {
    expect(classifyIntent('just show me sports')).toBe('topic_filter');
  });

  // ── Discovery ───────────────────────────────────────────────────────────────
  it('classifies "what\'s trending" as discovery', () => {
    expect(classifyIntent("what's trending")).toBe('discovery');
  });

  it('classifies "what\'s popular right now" as discovery', () => {
    expect(classifyIntent("what's popular right now")).toBe('discovery');
  });

  // ── Article explain ─────────────────────────────────────────────────────────
  it('classifies "tell me more about this article" as article_explain', () => {
    expect(classifyIntent('tell me more about this article')).toBe('article_explain');
  });

  it('classifies "summarize this" as article_explain', () => {
    expect(classifyIntent('summarize this')).toBe('article_explain');
  });

  it('classifies "explain the main points" as article_explain', () => {
    expect(classifyIntent('explain the main points')).toBe('article_explain');
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  it('classifies "search for ATmosphere conference" as search', () => {
    expect(classifyIntent('search for ATmosphere conference')).toBe('search');
  });

  it('classifies "look up Node.js streaming" as search', () => {
    expect(classifyIntent('look up Node.js streaming')).toBe('search');
  });

  it('classifies "find me the registration page" as search', () => {
    expect(classifyIntent('find me the registration page')).toBe('search');
  });

  it('classifies "where can I register for ATmosphere" as search', () => {
    expect(classifyIntent('where can I register for ATmosphere')).toBe('search');
  });

  it('classifies "how do I sign up for the event" as search', () => {
    expect(classifyIntent('how do I sign up for the event')).toBe('search');
  });

  // ── Default → news_question ─────────────────────────────────────────────────
  it('classifies "What happened with the Fed rate decision?" as news_question', () => {
    expect(classifyIntent('What happened with the Fed rate decision?')).toBe('news_question');
  });

  it('classifies "What did I miss today?" as news_question', () => {
    expect(classifyIntent('What did I miss today?')).toBe('news_question');
  });

  it('classifies "Tell me about the latest AI developments" as news_question', () => {
    expect(classifyIntent('Tell me about the latest AI developments')).toBe('news_question');
  });

  it('classifies empty-ish strings as news_question', () => {
    expect(classifyIntent('  ')).toBe('news_question');
  });
});
