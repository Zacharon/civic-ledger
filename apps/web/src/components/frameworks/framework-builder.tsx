'use client';

import { X } from 'lucide-react';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import {
  decodeRules,
  describeTarget,
  encodeRules,
  MAX_RULES,
  type RuleSpec,
  targetKey,
} from '@/lib/framework-url';

export interface CandidateRollcall {
  congress: number;
  chamber: 'house' | 'senate';
  number: number;
  voteDate: string;
  question: string;
  result: string;
  billTitle: string | null;
  policyArea: string | null;
}

const builderParsers = {
  build: parseAsString,
  f: parseAsString,
  title: parseAsString,
  stance: parseAsString,
  rules: parseAsString,
  page: parseAsString,
};

const TEXT_DELAY_MS = 500;
type Choice = 'skip' | 'yea' | 'nay';

/**
 * Build a framework by choosing roll calls and the position that counts as aligned.
 * The spec lives in the URL, so results re-evaluate on the server as you choose and
 * the link is the framework: nothing is stored.
 */
export function FrameworkBuilder({ candidates }: { candidates: CandidateRollcall[] }) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useQueryStates(builderParsers, {
    shallow: false,
    scroll: false,
    startTransition,
  });
  const ids = { title: useId(), stance: useId(), filter: useId(), chamber: useId() };
  const rules = useMemo(() => decodeRules(state.rules), [state.rules]);
  const byKey = useMemo(() => new Map(rules.map((r) => [targetKey(r.target), r])), [rules]);

  const [title, setTitle] = useState(state.title ?? '');
  const [stance, setStance] = useState(state.stance ?? '');
  const [filter, setFilter] = useState('');
  const [chamber, setChamber] = useState<'all' | 'house' | 'senate'>('all');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const urlTitle = state.title ?? '';
  const urlStance = state.stance ?? '';
  useEffect(() => setTitle(urlTitle), [urlTitle]);
  useEffect(() => setStance(urlStance), [urlStance]);

  const commitText = (key: 'title' | 'stance', value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void setState({ [key]: value.trim() || null, f: null, build: '1', page: null });
    }, TEXT_DELAY_MS);
  };

  const writeRules = (next: RuleSpec[]) =>
    void setState({
      rules: next.length > 0 ? encodeRules(next) : null,
      f: null,
      build: '1',
      page: null,
    });

  const choose = (c: CandidateRollcall, choice: Choice) => {
    const target = {
      kind: 'rollcall' as const,
      congress: c.congress,
      chamber: c.chamber,
      number: c.number,
    };
    const key = targetKey(target);
    const rest = rules.filter((r) => targetKey(r.target) !== key);
    writeRules(choice === 'skip' ? rest : [...rest, { target, alignedPosition: choice }]);
  };

  const shown = candidates.filter((c) => {
    if (chamber !== 'all' && c.chamber !== chamber) return false;
    if (!filter.trim()) return true;
    const text =
      `${c.billTitle ?? ''} ${c.question} ${c.policyArea ?? ''} ${c.number}`.toLowerCase();
    return text.includes(filter.trim().toLowerCase());
  });
  const candidateKeys = new Set(candidates.map((c) => targetKey({ kind: 'rollcall', ...c })));
  const otherRules = rules.filter((r) => !candidateKeys.has(targetKey(r.target)));

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.title} className="text-sm font-semibold">
            Framework name
          </label>
          <input
            id={ids.title}
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              commitText('title', e.target.value);
            }}
            placeholder="e.g. My energy votes"
            className="field"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.stance} className="text-sm font-semibold">
            Your stated orientation{' '}
            <span className="font-normal text-ink-3">(shown with results)</span>
          </label>
          <input
            id={ids.stance}
            value={stance}
            maxLength={200}
            onChange={(e) => {
              setStance(e.target.value);
              commitText('stance', e.target.value);
            }}
            placeholder="e.g. favors grid investment"
            className="field"
          />
        </div>
      </div>

      {otherRules.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">Rules carried over</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {otherRules.map((r) => (
              <li key={targetKey(r.target)}>
                <button
                  type="button"
                  onClick={() => writeRules(rules.filter((x) => x !== r))}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-control bg-accent-wash px-2.5 text-sm hover:border-ink-2"
                >
                  {describeTarget(r.target)}: {r.alignedPosition === 'yea' ? 'Yea' : 'Nay'} aligns
                  <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
                  <span className="sr-only">(remove rule)</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-semibold">
            Choose roll calls{' '}
            <span className="num font-normal text-ink-3">
              ({rules.length} of up to {MAX_RULES} chosen)
            </span>
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.filter} className="text-sm font-semibold">
                Filter
              </label>
              <input
                id={ids.filter}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Bill, question or area"
                className="field w-60"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.chamber} className="text-sm font-semibold">
                Chamber
              </label>
              <select
                id={ids.chamber}
                value={chamber}
                onChange={(e) =>
                  setChamber(
                    e.target.value === 'house' || e.target.value === 'senate'
                      ? e.target.value
                      : 'all',
                  )
                }
                className="field"
              >
                <option value="all">Both</option>
                <option value="house">House</option>
                <option value="senate">Senate</option>
              </select>
            </div>
          </div>
        </div>
        <p className="mt-2 text-sm text-ink-3" role="status" aria-live="polite">
          {isPending
            ? 'Updating results…'
            : `${shown.length} roll calls shown. Results below update as you choose.`}
        </p>
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {shown.map((c) => {
            const key = targetKey({ kind: 'rollcall', ...c });
            const current: Choice = byKey.get(key)?.alignedPosition ?? 'skip';
            return (
              <li key={key}>
                <fieldset className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <legend className="sr-only">
                    {c.billTitle ?? c.question}, {c.chamber === 'house' ? 'House' : 'Senate'} roll
                    call {c.number}
                  </legend>
                  <div aria-hidden="true">
                    <p className="font-medium">{c.billTitle ?? c.question}</p>
                    <p className="num text-xs text-ink-3">
                      {c.voteDate} · {c.chamber === 'house' ? 'House' : 'Senate'} roll call{' '}
                      {c.number} · {c.question} · {c.result}
                      {c.policyArea ? ` · ${c.policyArea}` : ''}
                    </p>
                  </div>
                  <div className="inline-flex h-10 self-start rounded-control border border-control bg-surface p-0.5 md:self-center">
                    {(['skip', 'yea', 'nay'] as const).map((choice) => (
                      <label
                        key={choice}
                        className={`inline-flex cursor-pointer items-center rounded-[3px] px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                          current === choice
                            ? 'bg-accent font-semibold text-accent-ink'
                            : 'text-ink-2 hover:text-ink'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`rule-${key}`}
                          value={choice}
                          checked={current === choice}
                          onChange={() => choose(c, choice)}
                          className="sr-only"
                        />
                        {choice === 'skip'
                          ? 'Not used'
                          : choice === 'yea'
                            ? 'Yea aligns'
                            : 'Nay aligns'}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
