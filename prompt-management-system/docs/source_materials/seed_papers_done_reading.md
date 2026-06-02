# Seed Papers: Done and Reading Tiers

> Source list for `config/seed_papers.yaml`. Used by Agent 0 (Scout) during Phase 2 knowledge base construction.
>
> **Tier handling rule (per CLAUDE.md §7.1):**
> - **Done** papers are **force-included** in `validated_kb.md`. They skip the 5-point rubric. These are foundational paradigm-defining works that have already been reviewed and confirmed essential.
> - **Reading** papers are currently under detailed review by the researcher. They enter the candidate pool as seeds and are subject to the rubric (must score ≥ 4.0/5 to enter `validated_kb.md`).

---

## Tier Done — Foundational Paradigm and Reviewed Literature

### Stasser, G., and Titus, W. (1985)

**Title:** "Pooling of Unshared Information in Group Decision Making: Biased Information Sampling During Discussion"

**Summary:** A foundational study demonstrating that although it seems intuitive that groups would reach optimal decisions, they often do not. Humans tend to hide critical information they uniquely possess (unshared information) and repeatedly discuss commonly held information (shared information) — a pattern called "biased information sampling."

**Why include:** Used in the core problem framing of the proposal. The origin of the Hidden Profile paradigm and the foundational problem statement for "why groups bury unshared information and discuss only shared information."

---

### Seeber, I., et al. (2020)

**Title:** "Machines as teammates: A research agenda on AI in team collaboration"

**Summary:** Argues that whereas past AI was a "tool" (like Excel or a calculator), it has now been elevated to a "teammate" that offers opinions and negotiates. When AI becomes a teammate, the modes of communication, trust formation, and leadership dynamics among humans change fundamentally.

**Why include:** Essential theory for establishing the core independent variable of AI Status (Leader vs. Peer). Used when arguing why it is important to grant AI a status (rather than treating it as a simple aide) and observe the resulting interactions.

---

### Chen, X., et al. (2025) (originally cited as Yuan et al., 2025)

**Title:** "Maintaining 'Balanced' Conflict: Proactive Intervention Strategies of AI Voice Agents in Online Collaboration of Temporary Design Teams"

**Summary:** Addresses how AI, rather than being a passive entity that responds only when asked, proactively intervenes during group conflict or information imbalance to induce "balanced conflict" within a team.

**Why include:** Excellent reference when describing the specific intervention behaviors by which a Leader-status AI guides team discussion and elicits unshared information.

---

### Zercher, D., et al. (2025)

**Title:** "How Can Teams Benefit From AI Team Members? Exploring the Effect of Generative AI on Decision-Making Processes and Decision Quality in Team–AI Collaboration"

**Venue:** Journal of Organizational Behavior

**Summary:** A recent study demonstrating how, when modern generative AI (GenAI) is deployed into human teams, the AI offsets the information-processing asymmetries (such as IAM-related evaluation bias and negotiation focus) experienced by humans. Emphasizes that "how AI is integrated matters."

**Why include:** (1) Analyzes the effect of AI role on team performance and AI Knowledge Configuration. (2) Demonstrates that without social validation, information cannot be integrated even when present — providing grounds for IAM extension (AI-specific asymmetries: SMM and BtoM). Also an ideal reference for mixed-method experimental approaches including video coding and chat log analysis.

---

### Miller, T. (2019)

**Title:** "Explanation in artificial intelligence: Insights from the social sciences"

**Summary:** The most widely cited review paper in XAI research, defining "what makes a good explanation" from social science and cognitive psychology perspectives.

**Why include:** Provides the operational definition of "explanation" and the standard XAI definition. Serves as the ideal benchmark for comparing and contrasting how the explanatory nature or facilitative questioning approach of ACI (Artificial Collective Intelligence) differs from the standard XAI definition.

---

### Miller III (1977)

**Title:** (Review of Status Characteristics Theory; full title not specified in source list.)

**Summary:** A review and organization of the academic trajectory of Status Characteristics Theory (SCT).

**Why include:** Useful for grasping the development of the status characteristics theory underlying the AI Status variable.

---

### Berger, J., Cohen, B. P., and Zelditch, M. (1972)

**Title:** "Status Characteristics and Social Interaction"

**Venue:** American Sociological Review

**Summary:** A foundational and classic sociology paper that first established the framework of Status Characteristics Theory.

**Why include:** Grounds the use of SCT indicators in designing the Leader condition — i.e., the design justification for how human participants are made to perceive the AI as a "Leader."

---

### Brodbeck, F. C., Kerschreiter, R., Mojzisch, A., and Schulz-Hardt, S. (2007)

**Title:** "Group Decision Making Under Conditions of Distributed Knowledge: The Information Asymmetries Model"

**Venue:** Academy of Management Review

**Summary:** A major paper that elegantly applies and cites Status Characteristics Theory to explain why information is not adequately shared in group decision-making.

**Why include:** The root of Zercher's Information Asymmetries Model (IAM). Provides a strong theoretical basis for combining "Leader × ACI" in this study.

---

### Ganapini, M. B., Campbell, M., and Ho, K. (2023)

**Title:** "Value-based Fast and Slow AI Nudging"

**Summary:** Proposes an alternative, value-based conceptual framework for AI nudging that guides human behavior.

**Why include:** Smoothly connects ACI (Artificial Collective Intelligence) with nudge theory. Directly usable for establishing the nudge scope principles and guidelines of ACI.

---

### Lu, L., Yuan, Y. C., and McLeod, P. L. (2012)

**Title:** "Twenty-Five Years of Hidden Profiles in Group Decision Making: A Meta-Analysis"

**Summary:** A meta-analysis that statistically synthesizes effect sizes and conditions across 25 years of research using the Hidden Profile (HP) paradigm.

**Why include:** A precise reference for the core parameters needed in this experiment's design (information distribution ratios, group-size effect sizes, condition specifications).

---

## Tier Reading — Currently Under Review

### Alsobay, M., Rothschild, D., et al. (2025)

**Title:** "Bringing Everyone to the Table: An Experimental Study of LLM-Facilitated Group Decision Making"

**Summary:** A large-scale experiment with 1,475 participants empirically testing the effectiveness of an LLM acting as a facilitator in Hidden Profile tasks.

**Why include:** A recent study that directly examines the combination of "Hidden Profile + LLM Facilitator" at large scale. An ideal benchmark for experimental manipulation and results-analysis frames.

---

### Do et al. (2023), CSCW

**Title:** (Not specified in source list.)

**Summary:** Examines group decision-making and Hidden Profile situations from a collaborative systems and human–computer interaction (HCI) perspective.

**Why include:** Under review for CSCW-specific system design and mixed-method (qualitative + quantitative) analysis approaches.

---

### Schulz-Hardt, S. (2012)

**Title:** "How to achieve synergy in group decision making: Lessons to be learned from the hidden profile paradigm"

**Summary:** Synthesizes lessons on overcoming information loss in Hidden Profile situations and achieving "synergy" — performance beyond the simple sum of parts — in group decision-making.

**Why include:** Useful for constructing the logical bridge by which AI intervention (ACI) goes beyond merely surfacing information to producing higher-order outcomes (Decision Quality) through group synergy.

---

### Sohrab, S. G., et al. (2015)

**Title:** "Exploring the Hidden-Profile Paradigm: A Literature Review and Analysis"

**Summary:** A comprehensive literature review of the history, key variables, and experimental limitations of the Hidden Profile paradigm.

**Why include:** Reference material for clearly identifying common experimental pitfalls and prior-research limitations (research gaps) that arise when adopting the HP paradigm.
