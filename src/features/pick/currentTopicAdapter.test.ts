import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearCsrfToken } from '../../shared/api/client';
import {
  getCurrentTopic,
  submitCurrentTopicVote,
  VoteAlreadyRecordedError,
  VoteResultRefreshError,
} from './api';
import { currentTopicResponseAdapter } from './currentTopicAdapter';

const topic = {
  topicId: 42,
  title: '여행은 계획대로 vs 발길 닿는 대로?',
  description: null,
  targetDate: '2026-09-24',
  status: 'OPEN',
  options: [
    {
      optionId: 102,
      label: 'B',
      text: '발길 닿는 대로',
      description: null,
      voteCount: 199,
      percent: 100,
    },
    {
      optionId: 101,
      label: 'A',
      text: '꼼꼼하게 계획대로',
      description: null,
      voteCount: 1,
      percent: 1,
    },
  ],
  totalVotes: 200,
  votedOptionId: null,
};

function response(data: unknown) {
  return { message: "Today's topic retrieved", data, error: null };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('current topic response adapter', () => {
  it('uses the actual A/B labels and hides counts before the member votes', () => {
    const pick = currentTopicResponseAdapter.fromResponse(response(topic));

    expect(pick).toMatchObject({
      id: '42',
      question: topic.title,
      category: null,
      representativeDate: topic.targetDate,
      options: [
        { id: 101, choice: 'A', label: '꼼꼼하게 계획대로', imageUrl: null },
        { id: 102, choice: 'B', label: '발길 닿는 대로', imageUrl: null },
      ],
      userVote: null,
      result: null,
      representativeOpinions: { A: null, B: null },
      opinionsAvailable: false,
    });
  });

  it('maps a recorded option ID to the selected choice and derives consistent percentages', () => {
    const pick = currentTopicResponseAdapter.fromResponse(
      response({ ...topic, votedOptionId: 101 }),
    );

    expect(pick.userVote).toBe('A');
    expect(pick.result).toEqual({
      totalVotes: 200,
      options: {
        A: { count: 1, percent: 1 },
        B: { count: 199, percent: 99 },
      },
    });
  });

  it('rejects missing options, unknown vote IDs, and inconsistent counts', () => {
    expect(() =>
      currentTopicResponseAdapter.fromResponse(response({ ...topic, options: [topic.options[0]] })),
    ).toThrow();
    expect(() =>
      currentTopicResponseAdapter.fromResponse(response({ ...topic, votedOptionId: 999 })),
    ).toThrow();
    expect(() =>
      currentTopicResponseAdapter.fromResponse(response({ ...topic, totalVotes: 201 })),
    ).toThrow();
  });
});

describe('current topic vote', () => {
  it('sends the selected BE option ID with session cookies and shows the refreshed server result', async () => {
    const beforeVote = currentTopicResponseAdapter.fromResponse(response(topic));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'csrf-token' } })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Vote successful', data: null, error: null })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            response({
              ...topic,
              options: [{ ...topic.options[0], voteCount: 200 }, topic.options[1]],
              totalVotes: 201,
              votedOptionId: 102,
            }),
          ),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitCurrentTopicVote(beforeVote, 'B')).resolves.toMatchObject({
      id: '42',
      userVote: 'B',
      result: { totalVotes: 201 },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/csrf',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/topics/42/vote',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ optionId: 102 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/topics/today',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('never posts a vote without a BE option ID', async () => {
    const beforeVote = currentTopicResponseAdapter.fromResponse(response(topic));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitCurrentTopicVote(
        { ...beforeVote, options: [{ ...beforeVote.options[0], id: null }, beforeVote.options[1]] },
        'A',
      ),
    ).rejects.toThrow('missing a valid topic or option ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes a recorded vote from a failed result refresh', async () => {
    const beforeVote = currentTopicResponseAdapter.fromResponse(response(topic));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'csrf-token' } })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Vote successful', data: null, error: null })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitCurrentTopicVote(beforeVote, 'A')).rejects.toBeInstanceOf(
      VoteResultRefreshError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refreshes the existing choice after a duplicate-vote response', async () => {
    const beforeVote = currentTopicResponseAdapter.fromResponse(response(topic));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { token: 'csrf-token' } })))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response({ ...topic, votedOptionId: 101 }))),
      );
    vi.stubGlobal('fetch', fetchMock);

    const error = await submitCurrentTopicVote(beforeVote, 'B').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VoteAlreadyRecordedError);
    expect((error as VoteAlreadyRecordedError).pick.userVote).toBe('A');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('current topic request', () => {
  it('calls the current BE endpoint with session cookies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response(topic)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(getCurrentTopic()).resolves.toMatchObject({ id: '42', result: null });
    expect(fetch).toHaveBeenCalledWith(
      '/api/topics/today',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });
});
