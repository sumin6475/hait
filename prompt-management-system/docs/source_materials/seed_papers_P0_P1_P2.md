# Seed Papers: P0, P1, P2 Tiers

> Source list for `config/seed_papers.yaml`. Used by Agent 0 (Scout) during Phase 2 knowledge base construction.
>
> **Tier handling rule (per CLAUDE.md §7.1):**
> - **P0** papers are **force-included** in `validated_kb.md`. They skip the 5-point rubric.
> - **P1, P2** papers enter the candidate pool as seeds for keyword expansion. They are subject to the rubric and only enter `validated_kb.md` if they score ≥ 4.0/5.

---

## Tier P0 — Highest-Priority Reference and Foundational Literature

### Huang et al. (2025), Frontiers

**Title:** "Artificial social intelligence in teamwork"

**Summary:** Experiment in which three-person teams exchange real-time text-based advice with an AI advisor. Evaluates how AI affects teamwork processes through bidirectional communication (a flexible prompt–response system).

**Why include:** Used for designing AI intervention timing and method.

---

### Schmutz et al. (2024)

**Title:** "AI-teaming: Redefining Collaboration"

**Venue:** Current Opinion in Psychology

**Summary:** A recent review summarizing the current research landscape on trust, team dynamics, and shared cognition in Human–AI Teams (HATs). Essential for describing the limitations and necessity of HAIT research in the Literature Review section.

**Why include:** As the most recent comprehensive HAIT review, this is essential for summarizing the "current research landscape" in the Literature Review section.

---

### Thaler, Sunstein, and Balz (2010)

**Title:** "Choice Architecture"

**Venue:** University of Pennsylvania — School of Arts & Sciences

**Summary:** Proposes six tools available to choice architects: defaults, expecting error, understanding mappings, giving feedback, structuring complex choices, and creating incentives.

**Why include:** Provides the theoretical foundation for framing the AI as a "choice architect." Mapping ACI's facilitative questioning onto one of these six tools strengthens the operational definition of ACI.

---

### Weidmann, B. (2025)

**Title:** "Measuring Human Leadership Skills with AI Agents"

**Summary:** A landmark experimental paper demonstrating that human leadership performance when leading a team of AI agents in tasks such as Hidden Profile (information asymmetry) strongly predicts performance when leading an actual human team (ρ = 0.81).

**Why include:** Provides empirical justification for treating AI not as a mere tool but as a "social agent" — peer or leader. Direct empirical precedent for the AI Status variable in this study (AI Leader vs. Peer in Hidden Profile).

---

## Tier P1 — Major Variable Design and Theoretical Justification

### Gurkan and Yan (2023)

**Title:** "Chatbot Catalysts: Improving Team Decision-Making Through Cognitive Diversity and Information Elaboration"

**Venue:** ICIS 2023

**Summary:** Study on chatbot support in team decision-making showing that early/timed chatbot assistance can improve decision quality by promoting cognitive diversity and information elaboration. Examines how chatbot interventions influence information sharing and integration in teams.

**Why include:** Cited multiple times by Zercher. Directly applies an AI chatbot to a Hidden Profile task and offers a reference design for information distribution.

---

### Qian et al. (2025)

**Title:** "Deliberate Lab" (arXiv:2510.13011)

**Summary:** Presents Deliberate Lab, an open-source platform for running large-scale, real-time multi-party experiments with both human participants and LLM-based agents as first-class participants. Reports a 12-month public deployment (~88 experimenters, ~9k participants) and discusses workflows and usage patterns.

**Why include:** Technical reference for experiment platform design. Demonstrates an architecture that treats LLMs as "first-class participants."

---

### Schmutz, Outland, Kerstan, Georganta, and Ulfert (2024)

**Title:** "AI-Teaming: Redefining Collaboration in the Digital Era"

**Venue:** Current Opinion in Psychology

**Summary:** Redefines collaboration in the digital era and addresses interaction processes in human–AI teams.

**Why include:** Contributes to the theoretical positioning of ACI (artificial collective intelligence).

*Note: same primary work as the P0 entry; included again here at P1 for cross-tier traceability.*

---

### Zhang et al. (2023), CSCW

**Title:** "Investigating AI Teammate Communication Strategies and Their Impact in Human-AI Teams"

**Summary:** Through 60-participant interviews, derived four communication strategies humans expect from AI teammates. The key finding: AI proactive communication promotes the development of trust and situational awareness, whereas AI without proactive communication is not perceived as a teammate.

**Why include:** Foundation for the communication design that allows humans to perceive AI not as a tool but as a genuine teammate.

---

### Zvelebilova et al. (2024)

**Title:** (Title not specified in source list. Working description: research on the unequal distribution of AI access.)

**Summary:** A recent study addressing the influence of unequal distribution of AI access on within-team information asymmetry.

**Why include:** Frequently surfaced in literature search as an important recent context.

---

### Berger et al. (1977)

**Title:** "Status Characteristics Theory"

**Summary:** The theory that certain characteristics in a group form expectations about task performance, and that these expectations determine "who exerts influence" within the group.

**Why include:** Provides theoretical justification for the AI Status (Leader vs. Peer) variable. Without this theory, the argument for "why Leader is effective" is weakened. Serves as the source of theoretical justification for granting the AI structural authority in the Leader condition.

---

### Hoffmann et al. (2026), Scientific Reports

**Title:** "Drivers and influence of social conformity on decision making in human-AI teams"

**Summary:** Shows that when AI and humans provide advice of equivalent accuracy, participants weight human advice significantly more highly. Demonstrates that AI lacks the "normative pull" inherent to human peers.

**Why include:** Provides the core justification for the study's design that "tone alone is insufficient; tone must be combined with structural role (Status)."

---

## Tier P2 — Peripheral Context and Risk Hedging

### Flathmann et al. (2024)

**Title:** "What you say vs what you do: Utilizing positive emotional expressions to relay AI teammate intent within human-AI teams"

**Summary:** An experimental paper on how human teammates interpret AI teammates' use of varied positive emotional expressions in words and phrasing. When emotion-based communication is paired with action, trust in the AI teammate and the human teammates' positive mood increase.

**Why include:** Directly useful for designing the concrete "tone" of XAI (direct information presentation) and ACI (questioning-based intervention).

---

### Weinmann, Schneider, and vom Brocke (2016)

**Title:** "Digital Nudging"

**Venue:** Business & Information Systems Engineering

**Summary:** Defines digital nudging as "the use of user-interface design elements to guide people's behavior in digital choice environments."

**Why include:** Directly connects to the justification that ACI operates as a kind of "nudge" within the digital environment of a chat interface.

---

### arXiv (2025)

**Title:** "Belief Offloading in Human-AI Interaction"

**Summary:** Defines "belief offloading" as a cognitive externalization phenomenon in human–LLM interaction. Maps when people defer belief formation and maintenance to AI, and presents a classification scheme and normative implications.

**Why include:** Used to analyze the risk that ACI may unintentionally distort or transform human beliefs, and to strengthen the Risk Mitigation section of the research proposal.

---

### Berente, Gu, Recker, and Santhanam (2021)

**Title:** "Managing Artificial Intelligence"

**Venue:** MIS Quarterly (special issue editor's comments)

**Summary:** Frames managing AI as decisions across autonomy, learning, and inscrutability; describes shifting AI frontiers over time; outlines implications for IT/IS management research.

**Why include:** Provides a macro perspective for framing the management of AI along the dimensions of autonomy, learning, and inscrutability.

---

### Dennis, Lakhiwal, and Sachdeva (2023)

**Title:** "AI Agents as Team Members: Effects on Satisfaction, Conflict, Trustworthiness, and Willingness to Work With"

**Venue:** Journal of Management Information Systems (JMIS)

**Summary:** Lab experiment on AI agents as virtual team members. Manipulates teammate type (AI vs. human) and performance; finds AI teammates are perceived as higher in ability and integrity but lower in benevolence, leading to lower process satisfaction when an AI teammate is present.

**Why include:** Useful for identifying the mechanism by which team-process satisfaction may decline when an AI teammate is present.

---

### Feuerriegel, Hartmann, Janiesch, and Zschech (2024)

**Title:** "Generative AI"

**Venue:** Business & Information Systems Engineering

**Summary:** Catchword article conceptualizing "generative AI" within socio-technical systems. Summarizes model/system/application examples, outlines key limitations, and proposes a research agenda for Information Systems.

**Why include:** Useful when positioning generative AI theoretically within a socio-technical systems perspective.

---

### Flathmann et al. (2023)

**Title:** "Understanding the impact and design of AI teammate etiquette"

**Summary:** Experimentally manipulates AI teammate etiquette. Compares a directive condition where the AI overrides human input with a passive condition where the AI takes direction and uses polite language.

**Why include:** Useful for understanding the dynamics that arise from different AI intervention styles (directive vs. passive).

---

### Fügener et al. (2022)

**Title:** "Cognitive Challenges in Human-AI Collaboration"

**Venue:** Information Systems Research

**Summary:** A top-tier journal article experimentally demonstrating that in human–AI collaboration, humans often lack the metacognition about their own abilities needed to delegate tasks to AI appropriately — or, conversely, rely on AI excessively.

**Why include:** The strongest available evidence base for the "metacognitive laziness" phenomenon mentioned in the proposal. Essential when addressing cognitive delegation to AI.

---

### Georganta and Ulfert (2024)

**Title:** (Title not specified in source list. Working description: experimental study of trust formation in small human–AI teams.)

**Summary:** Experimental work on trust in human–AI teams. Compares trust emergence in human–AI vs. human–human teams and shows how perceived trustworthiness and similarity shape interpersonal trust and team trust.

**Why include:** Used to understand the limits and composition of trust formation in small human–AI teams.

---

### Zercher, Jussupow, and Heinzl (2023)

**Title:** "When AI Joins the Team: A Literature Review on Intragroup Processes and Their Effect on Team Performance in Team-AI Collaboration"

**Venue:** ECIS

**Summary:** Literature review on team–AI collaboration focusing on intragroup processes and their effects on team performance. Synthesizes evidence on how AI participation shapes team climate and processes and identifies mechanisms and research gaps.

**Why include:** Useful for identifying research gaps in AI collaboration from an intragroup-process perspective.
