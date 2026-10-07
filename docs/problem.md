# Problem

Modern people manage life across too many disconnected surfaces: task managers, calendars, reminders, notes, email, project tools. Even a simple ask like "what should I get done this afternoon?" requires the human to:

1. Open the task manager and read pending items.
2. Open the calendar and mentally overlay the schedule.
3. Estimate available focus time.
4. Prioritise against deadlines.
5. Decide the order.
6. Optionally set a reminder for a hard commitment.
7. Repeat this every time the day shifts.

A chatbot that answers "What tasks do I have?" is not helpful — it just moves reading from one surface to another. The user still does all the work.

## What's actually needed

An assistant that can:

- **Understand intent** from short natural language.
- **Gather context** by calling the right tools, in the right order.
- **Reason** across the results (deadlines vs. available time vs. priorities).
- **Take action** where safe (create a reminder, mark a task complete).
- **Explain what it did**, without leaking hidden reasoning traces.

That is the shape of an agentic productivity system, and it is what LifeOps demonstrates.

## Why MCP, why Alexa+

The Model Context Protocol (MCP) is the emerging standard for AI agents to discover and call tools. Alexa+ can talk to any compliant MCP server over Streamable HTTP. That means the same tools that power our web dashboard can be spoken to via Alexa+ — one server, one set of tools, two surfaces.

## Scope kept small on purpose

LifeOps ships with tasks, schedule, reminders, and a planning engine. That is enough to prove the workflow end-to-end. Integrations with Gmail, Slack, and other systems are on the roadmap but are deliberately out of scope for the initial submission (see `docs/friction-log.md` for the reasoning).
