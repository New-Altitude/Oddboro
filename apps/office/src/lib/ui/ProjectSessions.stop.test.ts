// The Projects window mounted in a browser-like document, against a stand-in
// office: Stop in a connected Claude session's header, its confirm, and what
// Remove's confirm says about windows still joined. Each test clicks as the
// owner does and reads what the window then shows and sends.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROJECT_WORDS } from '../project-words.ts';
import {
  asked,
  button,
  buttons,
  described,
  office,
  one,
  projectsWindow,
  refused,
  sameElement,
  sent,
  SESSION,
  settled,
  viewOf
} from './projects-window-under-test.ts';

/** The header's Stop, found by its accessible name, or `null`. */
const stopIn = (root: Element) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${PROJECT_WORDS.stopName}"]`);
const confirmIn = (root: Element) => root.querySelector('[role="alertdialog"]');

test('Stop shows only in a connected Claude session’s header', async (t) => {
  for (const { name, session, connected, shows } of [
    { name: 'a connected Claude session', session: SESSION, connected: true, shows: true },
    {
      name: 'a connected Codex session',
      session: { ...SESSION, agent: 'codex' },
      connected: true,
      shows: false
    },
    { name: 'a Claude session not connected', session: SESSION, connected: false, shows: false }
  ])
    await t.test(name, async () => {
      office({ sessions: [session], view: viewOf(connected, false) });
      const shown = await projectsWindow();
      try {
        const stop = stopIn(shown.target);
        assert.equal(!!stop, shows, described(stop));
        if (stop) assert.equal(stop.textContent?.trim(), PROJECT_WORDS.stopButton);
      } finally {
        await shown.unmount();
      }
    });
});

test('Stop asks in place with the ruled words, and Cancel sends nothing', async () => {
  office({ sessions: [SESSION], view: viewOf(true, true) });
  const shown = await projectsWindow();
  try {
    const before = sent.length;
    stopIn(shown.target)?.click();
    await settled(shown);
    const confirm = confirmIn(shown.target);
    assert.ok(confirm, 'the confirm shows');
    assert.equal(
      one(confirm, '#stop-warning').textContent,
      'This ends the session for every window joined to it. The conversation is kept.'
    );
    assert.equal(one(confirm, '#stop-warning').textContent, PROJECT_WORDS.stopConfirm);
    assert.equal(sent.length, before, 'nothing sent before the yes');

    button(confirm, PROJECT_WORDS.cancel).click();
    await settled(shown);
    sameElement(confirmIn(shown.target), null, 'the confirm closes');
    assert.equal(sent.length, before, 'nothing sent');
  } finally {
    await shown.unmount();
  }
});

test('Confirming Stop closes this window’s terminal before it asks the office to end the session, and brings it back when the office refuses', async (t) => {
  /** The window, with whether its terminal showed as the office got the end. */
  async function stopped(answer: (view: ReturnType<typeof viewOf>) => unknown) {
    const view = viewOf(true, true);
    let shown: Awaited<ReturnType<typeof projectsWindow>> | undefined;
    const terminalShows = () => !!shown?.target.querySelector('.term .xterm');
    let shownAsAsked: boolean | undefined;
    office({
      sessions: [SESSION],
      view,
      more: (s) => {
        if (s.action !== 'end') return {};
        shownAsAsked = terminalShows();
        return answer(view);
      }
    });
    shown = await projectsWindow();
    assert.ok(terminalShows(), 'the terminal shows first');
    stopIn(shown.target)?.click();
    await settled(shown);
    const confirm = confirmIn(shown.target);
    assert.ok(confirm, 'the confirm shows');
    button(confirm, PROJECT_WORDS.stopButton).click();
    await settled(shown);
    assert.deepEqual(
      asked('end').map((s) => s.id),
      [SESSION.id],
      'one end, for this session'
    );
    sameElement(confirmIn(shown.target), null, 'the confirm closes');
    return { shown, terminalShows, shownAsAsked };
  }

  await t.test('a refusal brings the terminal back and shows the office’s words', async () => {
    const { shown, terminalShows, shownAsAsked } = await stopped(() =>
      refused(PROJECT_WORDS.stopBusy)
    );
    try {
      assert.equal(shownAsAsked, false, 'closed before the office was asked');
      assert.ok(terminalShows(), 'back once the office refused');
      assert.equal(
        shown.target.querySelector('[role="alert"] p')?.textContent,
        PROJECT_WORDS.stopBusy
      );
    } finally {
      await shown.unmount();
    }
  });

  await t.test(
    'an end the office takes leaves the session not connected, with no error',
    async () => {
      const { shown, terminalShows, shownAsAsked } = await stopped((view) => {
        view.connected = false;
        return {};
      });
      try {
        assert.equal(shownAsAsked, false, 'closed before the office was asked');
        assert.ok(!terminalShows(), 'gone with the session');
        sameElement(shown.target.querySelector('[role="alert"]'), null, 'with no error');
        assert.equal(stopIn(shown.target), null, 'and no Stop');
        assert.ok(
          shown.target.textContent?.includes('This session is not connected to the office.'),
          described(shown.target)
        );
      } finally {
        await shown.unmount();
      }
    }
  );
});

test('Remove’s confirm says it ends the session in every window still joined only for a Claude session', async (t) => {
  for (const { name, session, says } of [
    {
      name: 'a Claude session not connected',
      session: SESSION,
      says: 'Remove this session from Projects? This ends the session for every window still joined to it. Work still waiting for it stops, and no Odd can send it more work. The conversation itself is kept: connect it again to bring the session back, then share it again with any Odd that should have it.'
    },
    {
      name: 'a Codex session not connected',
      session: { ...SESSION, agent: 'codex' },
      says: 'Remove this session from Projects? Work still waiting for it stops, and no Odd can send it more work. The conversation itself is kept: connect it again to bring the session back, then share it again with any Odd that should have it.'
    }
  ])
    await t.test(name, async () => {
      office({ sessions: [session], view: viewOf(false, false) });
      const shown = await projectsWindow();
      try {
        const body = one(shown.target, '.term');
        button(body, 'Remove').click();
        await settled(shown);
        const confirm = confirmIn(body);
        assert.ok(confirm, 'the confirm shows');
        assert.equal(one(confirm, '#remove-warning').textContent, says);
        assert.equal(buttons(confirm, 'Remove').length, 1, 'with its own Remove');
        assert.equal(buttons(confirm, PROJECT_WORDS.cancel).length, 1, 'and the shared Cancel');
      } finally {
        await shown.unmount();
      }
    });
});
