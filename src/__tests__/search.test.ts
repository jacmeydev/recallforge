import { describe, it, expect } from 'vitest';
import { tokenize } from '@/lib/services/search-service';

describe('tokenize', () => {
  it('parses plain text', () => {
    const tokens = tokenize('hello');
    expect(tokens).toEqual([{ type: 'text', value: 'hello' }]);
  });

  it('parses deck: filter', () => {
    const tokens = tokenize('deck:Matemáticas');
    expect(tokens[0]).toEqual({ type: 'deck', value: 'Matemáticas' });
  });

  it('parses quoted deck: filter', () => {
    const tokens = tokenize('deck:"Mi Mazo"');
    expect(tokens[0]).toEqual({ type: 'deck', value: 'Mi Mazo' });
  });

  it('parses tag: filter', () => {
    const tokens = tokenize('tag:verbos');
    expect(tokens[0]).toEqual({ type: 'tag', value: 'verbos' });
  });

  it('parses is: filter', () => {
    const tokens = tokenize('is:due');
    expect(tokens[0]).toEqual({ type: 'is', value: 'due' });
  });

  it('parses prop: with operator', () => {
    const tokens = tokenize('prop:lapses>3');
    expect(tokens[0]).toEqual({
      type: 'prop',
      value: 'lapses',
      operator: '>',
      propValue: 3,
    });
  });

  it('parses boolean operators', () => {
    const tokens = tokenize('tag:verbo AND is:due');
    expect(tokens.length).toBe(3);
    expect(tokens[1]).toEqual({ type: 'and', value: 'AND' });
  });

  it('parses NOT operator', () => {
    const tokens = tokenize('NOT tag:easy');
    expect(tokens[0]).toEqual({ type: 'not', value: 'NOT' });
    expect(tokens[1]).toEqual({ type: 'tag', value: 'easy' });
  });

  it('parses parentheses', () => {
    const tokens = tokenize('( tag:a OR tag:b )');
    expect(tokens[0].type).toBe('lparen');
    expect(tokens[tokens.length - 1].type).toBe('rparen');
  });

  it('handles complex query', () => {
    const tokens = tokenize('deck:Main tag:verb is:new prop:stability>=0.5');
    expect(tokens.length).toBe(4);
    expect(tokens[0].type).toBe('deck');
    expect(tokens[1].type).toBe('tag');
    expect(tokens[2].type).toBe('is');
    expect(tokens[3].type).toBe('prop');
  });

  it('parses quoted text', () => {
    const tokens = tokenize('"hello world"');
    expect(tokens[0]).toEqual({ type: 'text', value: 'hello world' });
  });
});
