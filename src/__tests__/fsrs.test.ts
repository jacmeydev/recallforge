import { describe, it, expect } from 'vitest';
import {
  mapRatingToGrade,
  mapGradeToRating,
  mapStateToCardState,
  mapCardStateToState,
} from '@/lib/fsrs';
import { Rating, State } from 'ts-fsrs';

describe('FSRS mapping utilities', () => {
  describe('mapRatingToGrade', () => {
    it('maps again → Rating.Again', () => {
      expect(mapRatingToGrade('again')).toBe(Rating.Again);
    });
    it('maps hard → Rating.Hard', () => {
      expect(mapRatingToGrade('hard')).toBe(Rating.Hard);
    });
    it('maps good → Rating.Good', () => {
      expect(mapRatingToGrade('good')).toBe(Rating.Good);
    });
    it('maps easy → Rating.Easy', () => {
      expect(mapRatingToGrade('easy')).toBe(Rating.Easy);
    });
  });

  describe('mapGradeToRating', () => {
    it('maps Rating.Again → again', () => {
      expect(mapGradeToRating(Rating.Again)).toBe('again');
    });
    it('maps Rating.Hard → hard', () => {
      expect(mapGradeToRating(Rating.Hard)).toBe('hard');
    });
    it('maps Rating.Good → good', () => {
      expect(mapGradeToRating(Rating.Good)).toBe('good');
    });
    it('maps Rating.Easy → easy', () => {
      expect(mapGradeToRating(Rating.Easy)).toBe('easy');
    });
  });

  describe('mapStateToCardState', () => {
    it('maps State.New → new', () => {
      expect(mapStateToCardState(State.New)).toBe('new');
    });
    it('maps State.Learning → learning', () => {
      expect(mapStateToCardState(State.Learning)).toBe('learning');
    });
    it('maps State.Review → review', () => {
      expect(mapStateToCardState(State.Review)).toBe('review');
    });
    it('maps State.Relearning → relearning', () => {
      expect(mapStateToCardState(State.Relearning)).toBe('relearning');
    });
  });

  describe('mapCardStateToState', () => {
    it('maps new → State.New', () => {
      expect(mapCardStateToState('new')).toBe(State.New);
    });
    it('maps learning → State.Learning', () => {
      expect(mapCardStateToState('learning')).toBe(State.Learning);
    });
    it('maps review → State.Review', () => {
      expect(mapCardStateToState('review')).toBe(State.Review);
    });
    it('maps relearning → State.Relearning', () => {
      expect(mapCardStateToState('relearning')).toBe(State.Relearning);
    });
  });
});
