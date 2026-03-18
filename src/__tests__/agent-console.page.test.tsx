import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentConsolePage from '@/app/(app)/agent-console/page';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AgentConsolePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/agent/recommendations')) {
        return jsonResponse({ recommendations: [] });
      }

      if (url.includes('/api/agent/academic-summary')) {
        return jsonResponse({
          cards: { total: 42, new: 5, mature: 21, overdue: 7 },
          subjects: [
            {
              id: 'sub-1',
              name: 'Cardiologia',
              program: 'Medicina',
              totalCards: 20,
              newCards: 2,
              matureCards: 10,
              overdueCards: 3,
              masteryPercent: 50,
              riskLevel: 'medium',
            },
          ],
          modules: [
            {
              id: 'mod-1',
              name: 'Hemodinamica',
              subjectName: 'Cardiologia',
              totalCards: 12,
              newCards: 1,
              matureCards: 6,
              overdueCards: 2,
              masteryPercent: 50,
              riskLevel: 'medium',
            },
          ],
          chapters: [
            {
              id: 'chap-1',
              name: 'Gasto cardiaco',
              subjectName: 'Cardiologia',
              moduleName: 'Hemodinamica',
              examScope: 'Parcial 1',
              totalCards: 8,
              newCards: 1,
              matureCards: 5,
              overdueCards: 1,
              masteryPercent: 63,
              riskLevel: 'low',
            },
          ],
          topics: [
            {
              id: 'topic-1',
              name: 'Precarga',
              subjectName: 'Cardiologia',
              moduleName: 'Hemodinamica',
              chapterName: 'Gasto cardiaco',
              priorityDefault: 'high',
              conceptualDifficultyDefault: 'hard',
              totalCards: 5,
              newCards: 0,
              matureCards: 3,
              overdueCards: 1,
              masteryPercent: 60,
              riskLevel: 'medium',
            },
          ],
          decks: [],
        });
      }

      if (url.includes('/api/agent/coverage')) {
        return jsonResponse({
          overall: {
            totalCards: 42,
            newCards: 5,
            matureCards: 21,
            overdueCards: 7,
            highRiskCards: 4,
            pendingAiReviewCards: 2,
            studiedCoveragePercent: 88.1,
            overdueRatioPercent: 16.7,
            curriculumLinkedCards: 35,
            curriculumLinkedPercent: 83.3,
            unlinkedCards: 7,
          },
          atRisk: {
            subjects: [
              {
                id: 'sub-1',
                name: 'Cardiologia',
                totalCards: 20,
                newCards: 2,
                matureCards: 10,
                overdueCards: 3,
                masteryPercent: 50,
                riskLevel: 'medium',
                coveragePercent: 90,
                overdueRatioPercent: 15,
              },
            ],
            topics: [
              {
                id: 'topic-1',
                name: 'Precarga',
                subjectName: 'Cardiologia',
                moduleName: 'Hemodinamica',
                chapterName: 'Gasto cardiaco',
                totalCards: 5,
                newCards: 0,
                matureCards: 3,
                overdueCards: 1,
                masteryPercent: 60,
                riskLevel: 'medium',
                coveragePercent: 100,
                overdueRatioPercent: 20,
              },
            ],
          },
          subjects: [],
          modules: [],
          chapters: [],
          topics: [
            {
              id: 'topic-1',
              name: 'Precarga',
              subjectName: 'Cardiologia',
              moduleName: 'Hemodinamica',
              chapterName: 'Gasto cardiaco',
              totalCards: 5,
              newCards: 0,
              matureCards: 3,
              overdueCards: 1,
              masteryPercent: 60,
              riskLevel: 'medium',
              coveragePercent: 100,
              overdueRatioPercent: 20,
            },
          ],
        });
      }

      if (url.includes('/api/agent/events')) {
        return jsonResponse({ events: [] });
      }

      if (url.includes('/api/agent/study-plan')) {
        return jsonResponse({ entries: [], totalMinutes: 0, totalCards: 0 });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders modules, chapters, topics and coverage metrics in the academic tab', async () => {
    render(<AgentConsolePage />);

    const academicTab = screen.getByRole('tab', { name: /Resumen Académico/i });
    fireEvent.mouseDown(academicTab);
    fireEvent.click(academicTab);

    await waitFor(() => {
      expect(screen.getByText('Módulos')).toBeTruthy();
    });

    expect(screen.getByText('Hemodinamica')).toBeTruthy();
    expect(screen.getByText('Capítulos')).toBeTruthy();
    expect(screen.getByText('Gasto cardiaco')).toBeTruthy();
    expect(screen.getByText('Temas')).toBeTruthy();
    expect(screen.getByText('Precarga')).toBeTruthy();
    expect(screen.getByText('Parcial 1')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
    expect(screen.getByText('hard')).toBeTruthy();
    expect(screen.getByText('Salud Académica')).toBeTruthy();
    expect(screen.getByText('Coverage estudiado')).toBeTruthy();
    expect(screen.getByText('Cards linkeadas')).toBeTruthy();
  });

  it('renders coverage and risk tab with at-risk entities', async () => {
    render(<AgentConsolePage />);

    const coverageTab = screen.getByRole('tab', { name: /Coverage y Riesgo/i });
    fireEvent.mouseDown(coverageTab);
    fireEvent.click(coverageTab);

    await waitFor(() => {
      expect(screen.getByText('Materias más en riesgo')).toBeTruthy();
    });

    expect(screen.getAllByText('Cardiologia').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Precarga').length).toBeGreaterThan(0);
    expect(screen.getByText('Link curricular')).toBeTruthy();
  });
});
