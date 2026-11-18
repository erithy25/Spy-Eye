# Erda — legal and regulatory research (Germany / EU)

Status: 18 November 2026. Compiled from web sources only. **This is a collection of what the sources say, not legal advice.**

## 0. How to read this file

- Every claim carries a link to the source it was taken from. Article, paragraph and margin numbers (Rn.) are given where the source gives them.
- Wording is paraphrased unless it is in quotation marks. German quotations are kept in German.
- Markers used:
  - **[not verified]** — I could not open a primary source for the point in this session. The claim comes from a secondary source, a search-result summary or (where stated) background knowledge, and must be checked before it is relied on.
  - **[reading]** — an inference by the researcher about what a source means for the product. It is not a statement of the source.
- Limits of this research run:
  - The web-search budget of the session ran out after sections 1–3 and 6. Sections 4 and 5 are therefore built from direct fetches of official pages (BSI, ZenDiS, Deutschland-Stack, Bundestag, EUR-Lex) and are thinner on press coverage.
  - `gesetze-im-internet.de`, `rv.hessenrecht.hessen.de`, `cio.bund.de` and `bundesfinanzministerium.de` returned HTTP 503/400 to the fetch tool. Federal statutes were read on mirrors (`dsgvo-gesetz.de`, `buzer.de`); the official URL is given next to the mirror.
  - Margin numbers of the Federal Constitutional Court judgment were extracted from the official HTML text by an automated reader and cross-checked, where possible, against the footnotes of the BfDI statement of 2 June 2026. Check them against the original before quoting.

---

## 1. Federal Constitutional Court, judgment of 16 February 2023 (1 BvR 1547/19, 1 BvR 2634/20) and what followed

### 1.1 Outcome

- § 49 Abs. 1 Alt. 1 HmbPolDVG (Hamburg) violates Art. 2 Abs. 1 in conjunction with Art. 1 Abs. 1 GG and is void. § 25a Abs. 1 Alt. 1 HSOG (Hessen) is incompatible with the same right ([judgment, Tenor][bverfg]; [press release 18/2023][bverfg-pm]).
- The Hessian rule stayed in force until a new rule, at the latest until 30 September 2023, under conditions: specific facts must support the suspicion of a particularly serious offence within the meaning of § 100b Abs. 2 StPO and the expectation of similar future offences endangering life, limb or the existence or security of the Federation or a Land; the use must be justified in writing; data from home surveillance, online searches, telecommunications surveillance, traffic-data queries, long-term observation, undercover officers or informants must be excluded ([press release, section C][bverfg-pm]).
- The court did not ban automated data analysis. It is a legitimate means, and a constitutional design is possible ([press release][bverfg-pm]).
- Hessen used the power "thousands of times a year" through the platform hessenDATA; Hamburg had not yet used its rule ([press release][bverfg-pm]).

### 1.2 The requirements the court set

| Topic | What the court said | Where |
|---|---|---|
| Interference | Automated analysis or evaluation of stored data interferes with the informational self-determination of everyone whose data is used in a person-related way. | [Leitsatz 1][bverfg] |
| Own weight | The weight comes from the earlier data collection (purpose limitation and change of purpose apply) **and** from the analysis itself, which has an "Eigengewicht" and needs its own justification. | [Leitsatz 2][bverfg] |
| Two levers | The weight is determined in particular by "Art und Umfang der verarbeitbaren Daten" and by the permitted method of analysis. The legislature can steer the weight through rules on data and methods. | [Leitsatz 3][bverfg] |
| Threshold for serious interference | A serious interference is justified only under the narrow conditions that apply to covert surveillance: protection of particularly weighty legal interests and at least a "hinreichend konkretisierte Gefahr". This can be dispensed with only if the analysis options are narrowly limited by clear norms. | [Leitsatz 4][bverfg]; Rn. 103–108 |
| Lower thresholds | Less weighty interferences can be justified for legal interests of at least considerable weight. With strict limits on data and methods, the principle of purpose limitation alone can suffice. A "gänzlich anlasslose automatisierte Auswertung" remains impermissible. | [Rn. 107–108][bverfg] |
| Volume of data | The more data can be included, the heavier the interference. The kinds of data matter too. | [Rn. 78][bverfg] |
| Private information, profiles | The weight rises if particularly private information can be obtained or if movement or behaviour profiles can be formed. | [Rn. 77][bverfg] |
| Uninvolved persons | It mitigates if only data of persons who gave cause is included. The Hessian and Hamburg rules did not distinguish and allowed broad inclusion of data of uninvolved persons. | [Rn. 84, 86][bverfg]; [press release B III 2 c aa][bverfg-pm] |
| Data from intrusive measures | Data from home surveillance or online searches may be included only under very narrow conditions; such data must be "vorab gekennzeichnet oder abgetrennt". | [Rn. 80–81, 118][bverfg] |
| Biometric data | "Eingriffsmildernd kann etwa der Ausschluss biometrischer Daten wirken." | [Rn. 87][bverfg] |
| Social networks, internet | Excluding data collected from social networks mitigates; a link to the internet aggravates. | [Rn. 79, 88][bverfg] |
| Method: search term vs. open search | The weight rises if the search is not based on a search term but looks for statistical anomalies. | [Rn. 93–94][bverfg] |
| Method: machine assessments | Machine assessments of facts are particularly intense, e.g. "predictive policing" with statements about the dangerousness of persons. | [Rn. 98][bverfg] |
| Method: learning systems | "Besonderes Eingriffsgewicht kann je nach Einsatzart die Verwendung lernfähiger Systeme, also Künstlicher Intelligenz (KI), haben." Learning systems can detach from human programming. With software of private actors or other states there is a risk of "unbemerkter Manipulation oder des unbemerkten Zugriffs auf Daten durch Dritte". | [Rn. 100][bverfg] |
| Explicit exclusion | If the legislature wants to lower the weight by excluding self-learning systems, this must be in the statute: "Der Einsatz selbstlernender Systeme muss dafür im Gesetz ausdrücklich ausgeschlossen sein." A factual limitation by the police is not enough. | [Rn. 121][bverfg] |
| Errors, discrimination | What matters is whether safeguards exist to detect and correct errors; the legislature must provide protective rules. | [Rn. 102][bverfg] |
| Transparency, legal protection, oversight | Proportionality requires transparency, individual legal protection and supervisory control. Effective control needs "eigenständig ausformulierte Begründungen" why certain data stocks are analysed. Control can be done by random samples and be split between independent and internal data protection officers. For complex matching software, safeguards against errors are needed, possibly a "staatliches Monitoring" of the software. | [Rn. 109][bverfg] |
| Access | Only "einzelne, entsprechend qualifizierte Mitarbeiterinnen und Mitarbeiter" should have access, secured by organisational and technical measures. | [Rn. 117][bverfg] |
| Statute vs. administration | The legislature must itself lay down the essential basics on the kind and scope of data and on the methods. The administration may specify further, but abstractly and generally, and must document and publish this so that control (e.g. by data protection officers) is possible. | [Leitsatz 5][bverfg]; Rn. 110–122 |

Notes on the brief:

- **Logging.** In the part of the reasons I could read (Rn. 75–175), the words "Protokollierung" or "protokolliert" do not appear; the court speaks of reasons, documentation, publication and control ([judgment][bverfg]). Explicit logging duties come from the Law Enforcement Directive Art. 25 and § 76 BDSG (section 3) and from the state statutes written after the judgment (e.g. Art. 61a Abs. 4 Satz 5 PAG, section 1.4). **[reading]**
- **Later case law.** The BfDI relies on a further judgment of 1 October 2024 (1 BvR 1160/19, BKAG): the state may not store all lawfully collected data as a precaution, and a data stock open as to its purpose is impermissible (quoted in [BfDI statement, p. 15–16, fn. 32, 35][bfdi-2026]). I did not open that judgment itself.

### 1.3 Hessen after the judgment (§ 25a HSOG)

- Hessen amended its police law in 2023 ([GFF overview][gff-overview]). The GFF complaint cites the HSOG as "zuletzt geändert durch Art. 2, Art. 4 des Gesetzes vom 29. Juni 2023 (GVBl. S. 456)" ([GFF complaint][gff-hsog-vb]) **[not verified — taken from a search-result excerpt of the PDF]**.
- Structure of the new § 25a HSOG according to a 2026 journal article: three tiers — (1) defence against concrete dangers for high-ranking legal interests, (2) concretised dangers of certain offences within a foreseeable period, (3) "vorbeugende Bekämpfung" of serious or particularly serious offences where "tatsächliche Anhaltspunkte" suffice. Permitted data: case-processing data, case data, traffic and telecommunications data, and register and internet data queried on a targeted basis; traffic and telecommunications data are excluded for tier 3. A role and rights concept is to be published by administrative regulation (Abs. 3); logging and deletion duties are in Abs. 4 ([Teichmann, HRRS 1/2026][hrrs]).
- Criticism: the same author holds that the tier "vorbeugende Bekämpfung" fails proportionality, and that machine-learning methods are not defined with normative clarity ([HRRS 1/2026][hrrs]). GFF says the legislature left essential rules to the police ([GFF overview][gff-overview]).
- New constitutional complaint: GFF filed "Hessendata II" in June 2024; it is pending and has been served on the other parties ([GFF overview][gff-overview]). The docket number 1 BvR 1557/24 appears in a CCC statement of 27 March 2026 ([CCC][ccc-hsog]) **[not verified — search-result summary only]**.
- Further amendment and state-court challenge: a Green parliamentary group application to the Hessian State Court (28 May 2025) attacks § 25a HSOG as last amended by the "Gesetz zur Stärkung der Inneren Sicherheit in Hessen" of 13 December 2024 ([application][gruene-stgh]) **[not verified — search-result summary only]**.
- I could not retrieve the official current wording of § 25a HSOG (state law portal returned HTTP 503).

### 1.4 Bavaria (VeRA, Art. 61a PAG)

- Art. 61a PAG took effect on 1 August 2024 ([Dr. Datenschutz, 22 July 2024][drds-vera]).
- Content of Art. 61a PAG (official text, "gilt ab 01.04.2026": [gesetze-bayern.de][pag-61a]; the thresholds in Abs. 1 and Abs. 2 were read on a mirror: [lxgesetze.de][pag-61a-mirror]):
  - Abs. 1: merging data from several of the police's own automated procedures to avert a danger or impending danger for important legal interests (life, limb, liberty; existence or security of Federation or Land; critical infrastructure).
  - Abs. 2: also to prevent offences under § 100b Abs. 2 StPO and certain other dangers. Satz 3 excludes the automated processing of DNA patterns, finger and palm prints and data from home surveillance and covert access to IT systems; Satz 4: "Satz 3 gilt entsprechend für eine automatisierte Verarbeitung von Audio- und Videodateien."
  - Abs. 4: specially selected and trained staff, access limited to what is necessary, only hits matching the search parameters are shown, the conditions must be documented, and "Das Vorgehen bei Maßnahmen nach den Abs. 1 und 2 ist zu protokollieren."
  - Abs. 5: not permitted are automated decision-making within the meaning of Art. 11 of Directive (EU) 2016/680, "eine Verwendung selbstlernender Systeme" and the direct automated matching of personal data from networks open to the public.
- Operation: test operation before September 2024, pilot from 2 September 2024, live operation from December 2024; uses are listed with legal interest and legal basis (Art. 61a Abs. 1 or Abs. 2 PAG) ([Bavarian Landtag, Drs. 19/7043, 8 July 2025][bay-lt-7043]).
- Scale: the Bavarian system relates to "ca. 39 Millionen Personendatensätze" ([DSK resolution, 17 September 2025][dsk-2025]).
- Litigation: GFF and the Chaos Computer Club filed a constitutional complaint against Art. 61a PAG on 23 July 2025; no decision is reported ([GFF][gff-bayern]; [beck-aktuell][beck-gff]).
- **[reading]** Abs. 2 Satz 4 and Abs. 5 mean that the Bavarian "Palantir statute" is not a legal basis for AI analysis of video files by the police. A police deployment of Erda in Bavaria would need a different, specific basis.

### 1.5 North Rhine-Westphalia (DAR, § 23 Abs. 6 PolG NRW)

- § 23 Abs. 6 PolG NRW was introduced in 2022 as a "clarifying" power; data protection authorities considered it unconstitutional ([HRRS 1/2026][hrrs]). GFF filed a complaint in October 2022 ([GFF overview][gff-overview]).
- NRW substantially amended its law in late 2025; in February 2026 the Federal Constitutional Court declined to hear the NRW complaint ([GFF overview][gff-overview]; also reported in [Verfassungsblog, 2 September 2026][vb-palantir] **[not verified — article text could not be opened]**). I found no docket number.
- The NRW data protection commissioner (31st activity report for 2025) has "Zweifel an der Verfassungsmäßigkeit" of the new law, criticises powers for self-learning systems and AI training, and points to the risk of access by US authorities under the CLOUD Act and FISA ([netzpolitik.org, 20 April 2026][np-nrw]).
- Contract: DAR has been supplied by Palantir since 2019 for at least €39 million; the contract was extended only until October 2026 ([netzpolitik.org][np-nrw]). On 10 July 2026 the LZPD NRW concluded a bridging contract with Palantir with a basic term of one year; a new analysis software is being tendered and the end of that procedure is "not foreseeable" ([NRW Interior Ministry press release][nrw-pm]).

### 1.6 Baden-Württemberg (2025)

- The interior ministry signed a contract with Palantir in spring 2025, before a legal basis existed ([netzpolitik.org, 13 November 2025][np-bw]). Press reports add that the contract dates from March 2025, uses the Bavarian framework contract and costs about €25 million over five years **[not verified — search-result summaries of press reports]**.
- 29 July 2025: the cabinet released the concept and a police-law amendment for consultation. The law is described as technology-neutral. Stated safeguards: review by the Parlamentarisches Kontrollgremium four times a year, BSI IT audits, contractual exclusion of back doors and covert data outflow, operation separated from the public internet in secured data centres in Germany under police control, access by foreign authorities excluded, time-limited use. The Palantir software is called a "Brückentechnologie"; a sovereign European software "Europa-VeRA" is to be developed with Airbus Defence and Space GmbH and Schwarz Digits ([Interior Ministry BW][bw-im]).
- The Landtag passed the police law on 12 November 2025. The Greens want to switch to an alternative "so schnell wie möglich und spätestens bis 2030". The law also allows processing of police data to develop, train, test and validate IT products including AI. The state data protection commissioner raised "eine ganze Reihe von Kritikpunkten". Readiness for use was announced for the second quarter of 2026 ([netzpolitik.org][np-bw]).
- The paragraph number of the new power was not verified.

### 1.7 Federal level 2023–2026

| Date | Event | Source |
|---|---|---|
| Early July 2023 | Interior Minister Faeser barred BKA and Bundespolizei from introducing "Bundes-VeRA"; the government said an analysis tool would be developed "in eigener digitaler Kompetenz" (Drs. 20/8390). | [Bundestag text archive][bt-vera-2023] |
| 1 Dec 2023 – 13 June 2024 | CDU/CSU motion to introduce Bundes-VeRA (Drs. 20/9495): first reading, hearing on 22 April 2024, vote removed from the agenda on 13 June 2024. | [Bundestag text archive][bt-vera-2023] |
| 21 March 2025 | Bundesrat resolution (Drs. 58/25) asks the federal government for a centrally operated, "digitally sovereign" automated data analysis platform for all police forces, with an interim solution. | [Bundesrat Drs. 58/25(B)][br-58-25] **[not verified — search-result summary]** |
| July–Aug 2025 | Press reports that Interior Minister Dobrindt is examining or favouring Palantir software for BKA and Bundespolizei, with objections from the SPD. The questioners in Drs. 21/4923 cite a Tagesspiegel report and a Stern interview of 26 August 2025. The government later called the assumption that the BMI had spoken in favour of a specific software "unzutreffend" (next row). | Question part and preliminary remark of [BT-Drs. 21/4923][bt-21-4923]; press reports themselves **[not verified]** |
| 20 March 2026 | Government answer: it is "unzutreffend" that the BMI has spoken in favour of a specific software. "Eine Entscheidung über die Beschaffung bestimmter Softwarelösungen ... ist bislang nicht getroffen worden." In the P20 programme a modular approach was decided. Requirements in any later procurement "würden ... produktneutral definiert". No federal R&D project for a holistic police analysis software exists. On the AI Act: classification depends on the concrete use; Commission guidelines under Art. 6(5) were still outstanding. The BfDI is heard under § 69 BDSG. | [BT-Drs. 21/4923][bt-21-4923] |
| 29 April 2026 | Cabinet adopts a package on digital investigative powers (automated data analysis, biometric matching with internet data, AI). | [Federal Government][breg-kabinett] |
| 26 May – 8 July 2026 | Bills: Drs. 21/6131, 21/6132 (BMI), 21/6806 (StPO, BMJV). First reading on 8 July 2026. § 98e StPO-E: cross-procedure analysis platforms, suspicion of a serious offence listed in § 100a Abs. 2 StPO, no direct link to non-police registers or internet services, each use triggered manually and case-related, no purely automated decisions. § 98d StPO-E: biometric matching with public internet data, not with real-time data. | [Bundestag text archive][bt-kw28] |
| 2 June 2026 | BfDI statement (see 1.9). | [BfDI][bfdi-2026] |
| 7 July 2026 | Government answer: P20 follows a "modularen und hybriden Ansatz" that can include existing products, in-house developments and "marktverfügbare Kaufprodukte". "Zugleich ist die digitale Souveränität Deutschlands und Europas entschieden zu gewährleisten, indem Datenhoheit und Transparenz bei jeder IT-Lösung sichergestellt sind." The government speaks neither for nor against a specific software. It refuses, on grounds of state welfare, to confirm or describe the reported purchase of "ArgonOS" (ChapsVision) by the BfV. | [BT-Drs. 21/7079][bt-21-7079] |
| 21 Sept 2026 | Public hearing of the Interior Committee on the three bills. | [Bundestag text archive][bt-kw28] |
| 18 Nov 2026 | The Bundestag page (dated 18 November 2026) reports no second or third reading and no vote. | [Bundestag text archive][bt-kw28] |

- Media reports of May 2026 say the Federal Office for the Protection of the Constitution chose the French platform ArgonOS (ChapsVision) instead of Palantir ([heise][heise-bfv]; [WinFuture][winfuture-bfv]) **[not verified — the government declined to confirm, see above]**.
- Civil-society view of the 2026 bills: GFF calls most of the package unconstitutional; AlgorithmWatch considers it contrary to EU law ([netzpolitik.org FAQ, 4 May 2026][np-faq]).

### 1.8 Data-protection conference (DSK)

- Resolution of 11 May 2023: general police and intelligence provisions do not do justice to complex analysis methods; specific, proportionate legal bases are needed, in which the legislature itself limits kind and scope of data and methods ([DSK, 11 May 2023][dsk-2023]).
- Resolution of 17 September 2025, "Automatisierte Datenanalyse durch Polizeibehörden verfassungskonform gestalten!" ([DSK, 17 September 2025][dsk-2025]):
  1. No complex data analysis without a specific legal basis.
  2. The legal basis must meet the constitutional standards; transparency, individual legal protection and supervisory control must be provided by statute.
  3. Digital sovereignty must be ensured when selecting systems: exclusion of access from, or transfers to, third countries whose legal order is not compatible with European law; "Nachvollziehbarkeit und die Beherrschbarkeit der Datenverarbeitung"; long-term reliability. "Diese Ziele können in aller Regel zuverlässig nur durch den Einsatz von Systemen erreicht werden, deren Anbieter ihren Sitz im Europäischen Wirtschaftsraum (EWR) haben." Systems must be "hinreichend offen" to allow a switch. The DSK refers to its position paper "Kriterien für Souveräne Clouds" of 11 May 2023.
  4. Use the P20 programme to develop compliant tools, "ggf. auf Basis von transparenten und kontrollierbaren Open Source-Produkten".

### 1.9 BfDI statement of 2 June 2026 on the federal bills

Source for all points: [BfDI, Ausschussdrucksache 21(4)179][bfdi-2026].

- The planned rules on biometric matching and automated data analysis are, in their current form, not compatible with higher-ranking law (p. 2).
- The bills do not use the staged approach drawn by the court; they provide sweeping analyses instead (p. 13).
- A permanently stored "Super-Datenbank" merging all police data is not constitutionally tenable; it is also not regulated how long data may be kept there (p. 14–16).
- Purpose separation inside the police (task performance, documentation, precautionary storage) must be kept; data of witnesses and victims must not flow into analysis by the back door (p. 13, 16–18).
- The drafts do not use the option of lowering the weight by explicitly excluding self-learning systems (p. 19, citing Rn. 120 f. of the judgment).
- For preventive powers only particularly weighty legal interests justify such analysis; on the repressive side this corresponds to particularly serious offences (§ 100b Abs. 2 StPO), not the § 100a Abs. 2 catalogue (p. 20–21).
- Missing safeguards: transparency of the procedures used, inspection rights of affected persons and defence counsel, notification (p. 21–22). The logging in § 98d Abs. 2 StPO-E does not cover the matched data and therefore "ermöglicht ... keine datenschutzrechtliche Kontrolle" (p. 12).
- On video: "Massenhafte Abgleiche und Analysen von Videodateien mit einem KI-System stellen keinen einfachen Abgleich dar. Deshalb bedarf es auch hier der Einschränkung auf schwere Taten." The Bundespolizei currently uses a partly automated AI system for mass biometric matching; § 98c StPO is not a suitable basis (p. 21).
- On real time: the exclusion of real-time data must be checked in each case, because under the AI Act real-time means processing "ohne erhebliche Verzögerung" (recital 17); otherwise a prohibited real-time remote biometric identification could occur (p. 11).
- On commercial face-search services: databases such as PimEyes and Clearview AI are "kaum mit der KI-VO sowie der DSGVO vereinbar" (p. 8).
- Evidence: the BfDI cites AG Reutlingen, decision of 11 February 2026 (5 Gs 19/26), which denied urgent suspicion and an arrest warrant in particular because the police result rested solely on face recognition software "deren Funktionsweise, Algorithmus, Referenzdaten und Qualitätsparameter nicht nachvollziehbar dokumentiert sind" (p. 8, fn. 17; [decision][ag-reutlingen], page could not be opened).

---

## 2. EU AI Act — Regulation (EU) 2024/1689, as amended by Regulation (EU) 2026/1744

Official texts: [Regulation (EU) 2024/1689][aia-oj]; [Regulation (EU) 2026/1744, "Digital Omnibus on AI"][omnibus]. Article texts were read on artificialintelligenceact.eu, which shows the consolidated wording with amendment markers.

### 2.1 Prohibitions in Article 5 relevant to Erda

| Provision | Content | Source |
|---|---|---|
| Art. 5(1)(d) | AI to "assess or predict the risk of a natural person committing a criminal offence" based solely on profiling or personality traits. Not covered: systems supporting a human assessment based on "objective and verifiable facts directly linked to a criminal activity". | [Art. 5][aia-5] |
| Art. 5(1)(e) | AI that creates or expands facial recognition databases through "untargeted scraping of facial images" from the internet or CCTV footage. | [Art. 5][aia-5] |
| Art. 5(1)(g) | Biometric categorisation systems that deduce or infer race, political opinions, trade union membership, religious or philosophical beliefs, sex life or sexual orientation. Not covered: labelling or filtering of lawfully acquired biometric datasets in law enforcement. | [Art. 5][aia-5] |
| Art. 5(1)(h) | "Real-time" remote biometric identification in publicly accessible spaces for law enforcement, unless strictly necessary for (i) targeted searches for victims of abduction, trafficking, sexual exploitation or missing persons, (ii) preventing a specific, substantial and imminent threat to life or a terrorist threat, (iii) locating or identifying suspects of Annex II offences punishable by at least four years. | [Art. 5][aia-5] |
| Art. 5(2)–(5) | Use under (h) only to confirm the identity of a specifically targeted person; fundamental rights impact assessment and registration; prior authorisation by a judicial or independent administrative authority (in urgent cases request within 24 hours); notification of each use; Member States must adopt national rules to allow it at all. | [Art. 5][aia-5] |
| Art. 5(1)(ba), (bb) (new) | AI generating non-consensual intimate images and child sexual abuse material; applies from 2 December 2026. | [Omnibus explorer][omnibus-explorer] |

Definitions that decide where Erda falls:

- "Biometric data": personal data from specific technical processing of physical, physiological or behavioural characteristics, such as facial images ([Art. 3(34)][aia-3]).
- "Remote biometric identification system": identifies persons without their active involvement, typically at a distance, by comparing biometric data with a reference database ([Art. 3(41)][aia-3]). The notion is defined functionally, "irrespectively of the particular technology, processes or types of biometric data used" ([recital 17][aia-r17]).
- "Real-time" covers "live" or "near-live" material such as video footage, without significant delay; "post" systems work on already captured material such as CCTV footage ([Art. 3(42), (43)][aia-3]; [recital 17][aia-r17]).
- "Biometric categorisation" means assigning persons to categories on the basis of their biometric data; the recital lists as examples "sex, age, hair colour, eye colour, tattoos, behavioural or personality traits, language, religion, membership of a national minority, sexual or political orientation" ([Art. 3(40)][aia-3]; [recital 16][aia-r16]).
- "Publicly accessible space", "law enforcement authority", "law enforcement": [Art. 3(44)–(46)][aia-3].

**[reading]** Consequences for the design:

- Leaving out face recognition and licence-plate recognition keeps Erda out of Art. 5(1)(e) and (h) and out of Annex III point 1(a). The functional definition means that any other matching of body features against a reference database (gait, body shape) would have to be assessed in the same way.
- Plain-language search over persons can become "biometric categorisation" if a query sorts people by attributes derived from their bodies (hair colour, age, sex, tattoos per recital 16). Queries that infer the attributes named in Art. 5(1)(g) must be blocked. Queries by clothing or carried objects are not named in recital 16; they remain personal data under data protection law (section 3.4).
- No person-related risk scores: Art. 5(1)(d).

### 2.2 Annex III areas that could cover the system

Source: [Annex III][aia-annex3]; classification rule: [Art. 6][aia-6].

- Point 1 — biometrics: (a) remote biometric identification (verification excluded), (b) biometric categorisation according to sensitive or protected attributes, (c) emotion recognition.
- Point 2 — critical infrastructure: AI intended as a **safety component** in the management and operation of critical digital infrastructure, road traffic, or the supply of water, gas, heating or electricity.
- Point 5(d) — AI to evaluate and classify emergency calls or to dispatch, or establish priority in dispatching, emergency first response services (police, firefighters, medical aid), including emergency patient triage.
- Point 6 — law enforcement: (a) risk of becoming a victim, (b) polygraphs, (c) evaluating the reliability of evidence, (d) risk of offending or re-offending not solely based on profiling, (e) profiling in the detection, investigation or prosecution of offences.
- Art. 6(3): an Annex III system is not high-risk if it poses no significant risk, e.g. because it performs a narrow procedural task or a preparatory task. This derogation never applies where the system performs profiling of natural persons. A provider relying on it must document the assessment and register ([Art. 6(3), (4)][aia-6]; registration duty in [Art. 49(2)][aia-49]; the omnibus recitals say this registration is "simplified" — exact wording **[not verified]**).
- The Commission published draft guidelines on high-risk classification on 19 May 2026 with a consultation until 23 July 2026 ([DLA Piper summary][hr-guidelines-draft]) **[not verified — search-result summary; final status unknown]**. In March 2026 the federal government still described these guidelines as outstanding ([BT-Drs. 21/4923, answer 18][bt-21-4923]).

**[reading]** A search and alerting tool for civil protection is not law enforcement. It can come under point 5(d) if its output is used to prioritise dispatch, and under point 2 if it becomes a safety component of critical infrastructure. Sold to police, standing alerts on persons and the evaluation of video as evidence point to point 6.

### 2.3 Application dates

| Date | What applies | Source |
|---|---|---|
| 1 Aug 2024 | Entry into force. | [Art. 113][aia-113] |
| 2 Feb 2025 | Chapters I and II: general provisions, AI literacy (Art. 4), prohibitions (Art. 5). | [Art. 113(a)][aia-113] |
| 2 Aug 2025 | Chapter III Section 4 (notified bodies), Chapter V (general-purpose AI models), Chapter VII (governance), Chapter XII (penalties) and Art. 78, except Art. 101. | [Art. 113(b)][aia-113] |
| 2 Aug 2026 | General date of application of the Regulation. | [Art. 113][aia-113] |
| 2 Dec 2026 | New prohibitions Art. 5(1)(ba), (bb); end of the grace period for Art. 50(2) marking for generative systems placed on the market before 2 August 2026. | [Omnibus, Art. 113(a), Art. 111(4)][omnibus] |
| 2 Aug 2027 | Original date for Art. 6(1)/Annex I systems — **moved** (see next rows). National AI regulatory sandboxes must be operational by this date. | [Omnibus explorer][omnibus-explorer] |
| 2 Dec 2027 | Chapter III Sections 1–3 for high-risk systems under Art. 6(2) and Annex III (originally 2 August 2026). | [Omnibus, Art. 113(c)(i)][omnibus] |
| 2 Aug 2028 | Chapter III Sections 1–3 for high-risk systems under Art. 6(1) and Annex I (originally 2 August 2027). | [Omnibus, Art. 113(c)(ii)][omnibus] |
| 2 Aug 2030 | Providers and deployers of high-risk systems intended for use by public authorities that were placed on the market before the application date must comply by this date. | [Omnibus, Art. 111(2)][omnibus] |

- The "digital omnibus" is no longer a proposal. The Commission proposed it on 19 November 2025 ([Commission][omnibus-proposal]). It was adopted as Regulation (EU) 2026/1744 of 8 July 2026, published on 24 July 2026 and entered into force on the third day after publication ([EUR-Lex][omnibus]; [explorer][omnibus-explorer] gives 27 July 2026).
- Other changes: AI literacy becomes a duty to "take measures to support" literacy (Art. 4); new Art. 4a on special categories of data for bias detection; simplified documentation for SMEs and small mid-caps; the Art. 27 assessment may cross-reference the data protection impact assessment ([omnibus][omnibus]; [explorer][omnibus-explorer]).
- German implementation: the "Gesetz zur Marktüberwachung und Innovationsförderung von künstlicher Intelligenz" (KI-MIG) entered into force on 29 July 2026; the Bundesnetzagentur is market surveillance authority, complaints office and single point of contact and will set up an AI sandbox ([Bundesnetzagentur, 29 July 2026][bnetza-kimig]). For high-risk systems in law enforcement (Annex III points 1, 6, 7, 8) the AI Act requires the data protection supervisory authorities, or an authority under the same independence conditions, as market surveillance authority ([Art. 74(8)][aia-74]). Which German authority that is under the KI-MIG was not verified.

### 2.4 Obligations for high-risk systems

Providers ([Art. 16][aia-16]):

- Risk management system as a "continuous iterative process" over the lifecycle, with testing against previously defined metrics and probabilistic thresholds ([Art. 9][aia-9]).
- Data and data governance: training, validation and test data relevant, sufficiently representative and as far as possible free of errors; examination of biases; account of the geographical and contextual setting. For systems that do not train models the rules apply to the test data ([Art. 10][aia-10]).
- Technical documentation, instructions for use with declared accuracy metrics ([Art. 15(3)][aia-15]).
- **Logging, Art. 12:** the system must technically allow "automatic recording of events (logs)" over its lifetime, to identify risk situations, support post-market monitoring and monitor operation. For remote biometric identification systems the minimum is: period of each use, reference database, input data that led to a match, and the persons who verified the result ([Art. 12][aia-12]).
- **Human oversight, Art. 14:** design so that persons can understand capacities and limits, remain aware of "automation bias", interpret the output correctly, decide not to use or to override the output, and stop the system. For Annex III point 1(a) systems no action may be taken unless two persons have verified the identification (with a law-enforcement exception where disproportionate) ([Art. 14][aia-14]).
- Accuracy, robustness and cybersecurity, including resilience against data poisoning, model poisoning, adversarial examples and confidentiality attacks ([Art. 15][aia-15]).
- Quality management system, conformity assessment, EU declaration of conformity, CE marking, registration in the EU database ([Art. 16][aia-16]; [Art. 49][aia-49]).

Deployers ([Art. 26][aia-26]):

- Use according to the instructions; assign human oversight to competent, trained persons; ensure relevant input data; monitor operation and report risks and serious incidents.
- Keep the automatically generated logs for a period appropriate to the purpose, **at least six months**, unless other law provides otherwise (Art. 26(6)).
- Public authorities must register their use and must not use a system that is not in the EU database (Art. 26(8); [Art. 49(3)][aia-49]). For law enforcement, migration and border control the registration is in a secure non-public section; critical-infrastructure systems are registered nationally ([Art. 49(4), (5)][aia-49]).
- Use the provider's information for the data protection impact assessment (Art. 26(9)).
- Post-remote biometric identification: authorisation before or within 48 hours, no untargeted use, no decision based solely on the output, documentation in the police file, annual reports (Art. 26(10)).
- Inform natural persons who are subject to decisions made or assisted by an Annex III system (Art. 26(11)).

Fundamental rights impact assessment ([Art. 27][aia-27]):

- Required before first use from deployers that are bodies governed by public law or private entities providing public services (and for Annex III point 5(b), (c)). Not required for Annex III point 2 systems.
- Content: the deployer's processes, period and frequency of use, categories of affected persons, specific risks, human oversight measures, and measures if risks materialise including complaint mechanisms. The result is notified to the market surveillance authority. It may build on the data protection impact assessment.

### 2.5 Exemptions in Article 2

Source: [Art. 2][aia-2].

- Art. 2(3): the Regulation does not apply to AI systems placed on the market, put into service or used "exclusively for military, defence or national security purposes", regardless of the type of entity carrying out those activities. Member States' national-security competences are unaffected.
- Art. 2(6): systems and models developed and put into service for the sole purpose of scientific research and development are excluded.
- Art. 2(8): research, testing and development before placing on the market are excluded; "Testing in real world conditions shall not be covered by that exclusion."
- Art. 2(12): the exception for systems released under free and open-source licences does not apply if they are placed on the market or put into service as high-risk systems or fall under Art. 5 or Art. 50.

**[reading]** Police, civil protection and infrastructure operators are not "exclusively" national security users. The exemption therefore does not carry the product; open model weights do not remove high-risk obligations either.

---

## 3. Data protection

### 3.1 Which regime applies to which customer

- **Civil protection and fire services:** GDPR plus state law. The Thuringian commissioner applies the GDPR and the ThürDSG to drones of public bodies ([TLfDI, Orientierungshilfe Flugdrohnen, March 2021][tlfdi-drohnen]). The NRW government states that processing of drone data depends on the rules applicable to the acting authority, "etwa der Datenschutz-Grundverordnung (DS-GVO) und des DSG NRW", and that § 46 BHKG contains specific rules for disaster control ([Landtag NRW, Drs. 18/10805][nrw-18-10805]).
- **Police and prosecution:** Directive (EU) 2016/680 and its transposition. Part 3 of the BDSG applies to public bodies competent for the prevention, investigation, detection, prosecution or punishment of criminal or administrative offences, including protection against dangers to public security ([§ 45 BDSG][bdsg-45]); state police are governed by state law (for NRW e.g. § 37 DSG NRW, per [Drs. 18/10805][nrw-18-10805]).
- **Private critical-infrastructure operators:** GDPR. Video surveillance by private parties is assessed under Art. 6(1)(f) GDPR; Art. 6(1)(e) covers only public tasks, and there is no room for § 4 Abs. 1 BDSG ([BVerwG, 27 March 2019, 6 C 2.18, press release][bverwg]).

### 3.2 GDPR

- Art. 5: lawfulness and transparency, purpose limitation, data minimisation, accuracy, storage limitation, integrity and confidentiality, accountability ([Art. 5][gdpr-5]; text not re-fetched in this session, principles as applied in [TLfDI][tlfdi-drohnen]).
- Art. 6: for public bodies the bases are Art. 6(1)(e) with Art. 6(3) and a provision of Member State law defining the task; Art. 6(1)(d) (vital interests) is an exceptional basis that recital 46 links to humanitarian emergencies and natural and man-made disasters; consent is not given by merely being in the monitored area ([TLfDI, p. 6][tlfdi-drohnen]; [Art. 6][gdpr-6]). Art. 6(1)(f) is not available to authorities performing their tasks ([Drs. 18/10805, answer 2][nrw-18-10805]).
- Art. 9: processing of special categories is prohibited, including "biometric data for the purpose of uniquely identifying a natural person"; exceptions include vital interests (9(2)(c)) and substantial public interest on the basis of law with safeguards (9(2)(g)) ([Art. 9][gdpr-9]). Video footage is not in itself biometric data unless it is specifically technically processed to contribute to identification; Art. 9 applies when templates are stored to uniquely identify a person; distinguishing categories of people without uniquely identifying anyone is outside Art. 9 ([EDPB Guidelines 3/2019][edpb-video]) **[not verified — search-result excerpts; paragraph numbers not checked]**.
- Art. 25: data protection by design and by default ([Art. 25][gdpr-25]; text not re-fetched; the parallel wording for the law-enforcement area is in § 71 BDSG, section 3.3).
- Art. 35: an impact assessment is required where processing, "in particular using new technologies", is likely to result in a high risk; in particular for "systematic monitoring of a publicly accessible area on a large scale" (Art. 35(3)(c)) and large-scale processing of special categories (Art. 35(3)(b)). Minimum content: systematic description, necessity and proportionality, risks, measures (Art. 35(7)) ([Art. 35][gdpr-35]).

### 3.3 Law Enforcement Directive (EU) 2016/680 and BDSG Part 3

Directive ([consolidated text on EUR-Lex][led]):

- Art. 4: purpose limitation, data "adequate, relevant and not excessive", storage limitation, security, accountability. Art. 5: time limits for erasure or periodic review. Art. 6: distinguish suspects, convicted persons, victims and other parties such as witnesses.
- Art. 10: special categories, including biometric data for unique identification, "only where strictly necessary" and with safeguards.
- Art. 11: no decision based solely on automated processing with adverse legal effect unless authorised by law with safeguards, at least human intervention; profiling that discriminates on the basis of special categories is prohibited.
- Art. 20: data protection by design and by default.
- **Art. 25 logging:** logs for at least collection, alteration, consultation, disclosure including transfers, combination and erasure. Logs of consultation and disclosure must make it possible to establish the justification, date and time and, as far as possible, the identity of the person who consulted or disclosed and of the recipients. Logs may be used only to verify lawfulness, for self-monitoring, to ensure integrity and security, and for criminal proceedings; they must be made available to the supervisory authority.
- Art. 27: impact assessment; Art. 28: prior consultation of the supervisory authority; Art. 29: security controls (equipment access, data media, storage, user, data access, communication, input, transport, recovery, reliability, integrity).

BDSG Part 3 (mirror texts; official site not reachable):

- **§ 76 Protokollierung:** in automated processing systems at least collection, alteration, consultation, disclosure including transfer, combination and erasure must be logged. Logs of consultations and disclosures must show the reason, date and time and, as far as possible, who consulted or disclosed and who received the data. Logs may be used only for checking lawfulness by the data protection officer, the BfDI and the data subject, for self-monitoring, for integrity and security, and for criminal proceedings. They must be deleted at the end of the year following their creation and made available to the BfDI on request ([§ 76 BDSG][bdsg-76]; official: [gesetze-im-internet.de][bdsg-76-off]).
- **§ 71 Datenschutz durch Technikgestaltung:** measures to implement data minimisation at the time of choosing the means and during processing; process as little personal data as possible; anonymise or pseudonymise as early as the purpose allows; by default only data necessary for the specific purpose; data must not by default be accessible to an indefinite number of persons ([§ 71 BDSG][bdsg-71]).
- § 48: special categories only if "zur Aufgabenerfüllung unbedingt erforderlich", with safeguards such as access restriction, separate processing, pseudonymisation, encryption ([§ 48 BDSG][bdsg-48]).
- § 64: security of processing with fourteen control objectives (Zugangskontrolle … Trennbarkeit); controllers must take the relevant BSI technical guidelines and recommendations into account ([§ 64 BDSG][bdsg-64]).
- § 67: impact assessment where processing is likely to result in a "voraussichtlich erhebliche Gefahr für die Rechtsgüter betroffener Personen", with involvement of the data protection officer ([§ 67 BDSG][bdsg-67]).
- § 69: for IT products used by BKA and Bundespolizei the BfDI "ist nach Maßgabe von § 69 des Bundesdatenschutzgesetzes anzuhören" ([BT-Drs. 21/4923, answer 19][bt-21-4923]; the text of § 69 itself was not opened).

### 3.4 Video surveillance: § 4 BDSG and state law

- § 4 BDSG: video surveillance of publicly accessible spaces is permitted only if necessary for the tasks of public bodies, for the exercise of domiciliary rights or for legitimate interests for specified purposes, and if interests of the data subjects do not prevail. The surveillance and the controller must be made recognisable at the earliest possible time. Storage or use is permitted if necessary for the purpose; use for another purpose only to avert dangers to state and public security and to prosecute crimes. Data must be deleted without delay when no longer necessary ([§ 4 BDSG][bdsg-4]).
- Scope: for private controllers the provision is displaced by the GDPR ([BVerwG][bverwg]). For public bodies of the Länder the state data protection acts apply, e.g. § 21 LDSG Rheinland-Pfalz ([LfDI RLP][lfdi-rlp-drohnen]), § 30 ThürDSG ([TLfDI][tlfdi-drohnen]), § 14 NDSG ([LfD Niedersachsen][lfd-nds-faq]) **[§ 14 NDSG not verified — search-result summary]**.
- Fixed-installation rules do not automatically cover drones: § 30 ThürDSG requires an at least temporarily location-bound installation and therefore does not cover drones ([TLfDI, p. 5][tlfdi-drohnen]).

### 3.5 What supervisory authorities say about drones and video in fire and disaster services

- What counts as personal data: not only clear images of faces, but also "Kleidung, Gangbild, Figur, Haarfarbe, mitgeführte Gegenstände, aber auch Fahrzeugkennzeichen, Gebäude, Anschriften". It is irrelevant whether the controller aims at identification. Only overview footage from great height without zoom, or with permanent irreversible pixelation, falls outside the GDPR ([TLfDI, p. 5][tlfdi-drohnen]). **[reading]** Masking faces is data minimisation, not anonymisation.
- Legal basis must be checked for each individual deployment; purpose must be fixed before operation; purpose change only under Art. 6(4) GDPR and state law ([TLfDI, p. 6–7][tlfdi-drohnen]).
- Proportionality: check milder means; for training and exercise flights persons must not be recognisable, by flight height or pixelation ([TLfDI, p. 7][tlfdi-drohnen]).
- Further duties: check the need for an impact assessment, technical and organisational measures (name authorised persons by service instruction), record of processing activities, information under Art. 13 GDPR (e.g. signs on vehicles in the operational area), fixed deletion period, early involvement of the data protection officer ([TLfDI, p. 8][tlfdi-drohnen]).
- Rheinland-Pfalz: use drones as far as possible without processing personal data; lowest possible resolution and automatic pixelation; "Zoom- und Tonfunktionen sind grundsätzlich zu deaktivieren." ([LfDI RLP][lfdi-rlp-drohnen]). The page still cites § 39a of the old LBKG; the rule is now § 60 LBKG 2025 (section 6).
- NRW government: "Jeder Eingriff in Grundrechte bedarf wegen des Vorbehalts des Gesetzes einer gesetzlichen Grundlage." Whether a general clause such as § 3 DSG NRW suffices or a specific rule is needed "ist eine Frage des jeweiligen Anwendungsfalls". The government saw no need for additional legislation ([Drs. 18/10805, answer 1][nrw-18-10805]).
- Court: the Bavarian Higher Administrative Court (15 February 2024, 4 CE 23.2267) held that the general clause of Art. 4 Abs. 1 BayDSG is not a sufficient basis for a municipal drone flight over a residential property without consent, and that images of properties are personal data ([press release][bayvgh-pm]; [decision][bayvgh]) **[not verified — search-result summary; described the same way in [Drs. 18/10805][nrw-18-10805]]**.
- The DSK position paper on camera drones of 16 January 2019 covers non-public bodies only ([DSK][dsk-drohnen]; so stated in [Drs. 18/10805, answer 2][nrw-18-10805]).

### 3.6 Impact assessment for video analytics

- Triggers: Art. 35(1) and (3)(c) GDPR ([Art. 35][gdpr-35]); § 67 BDSG and Art. 27 of the Directive for the law-enforcement area ([§ 67 BDSG][bdsg-67]; [Directive][led]); AI Act Art. 26(9) and Art. 27 for high-risk systems ([Art. 26][aia-26]; [Art. 27][aia-27]).
- Method: DSK Kurzpapier Nr. 5 on the impact assessment ([DSK][dsk-kp5], referenced by [TLfDI, p. 8][tlfdi-drohnen]; content not opened).
- Lists under Art. 35(4) GDPR: the supervisory authorities publish lists of processing operations that require an assessment; a joint DSK list exists for the non-public sector, and the Länder have lists for the public sector (e.g. [LDA Brandenburg][lda-bb-dsfa]). Entries on video analysis and AI were **[not verified]**.
- AI guidance of the DSK: Orientierungshilfe "Künstliche Intelligenz und Datenschutz" (6 May 2024) ([DSK][dsk-oh-ki]) and Orientierungshilfe on technical and organisational measures for the development and operation of AI systems (June 2025) ([DSK][dsk-oh-ki-tom]) **[not verified — search-result summaries]**.
- Face recognition: DSK resolution of 20 September 2024 demands specific, proportionate legal bases with thresholds and additional safeguards ([DSK][dsk-gesicht], quoted in [BfDI statement, p. 4][bfdi-2026]).

---

## 4. Evidence and audit

### 4.1 What makes digital evidence and logs usable in German courts

- Criminal procedure: the court decides on the result of the taking of evidence according to its free conviction drawn from the hearing as a whole (§ 261 StPO, [official text][stpo-261]) **[not verified — page not reachable; cited from background knowledge]**. There is no fixed list of formal requirements; weight depends on whether integrity and origin can be shown. **[reading]**
- Civil procedure: private electronic documents with a qualified electronic signature carry a presumption of authenticity that can be shaken only by facts raising "ernstliche Zweifel"; electronic documents created by an authority in the prescribed form are treated as public documents, and with a qualified electronic signature or seal § 437 ZPO applies ([§ 371a ZPO][zpo-371a]).
- Algorithmic evidence must be documented: AG Reutlingen (11 February 2026, 5 Gs 19/26) refused to base urgent suspicion on software whose "Funktionsweise, Algorithmus, Referenzdaten und Qualitätsparameter nicht nachvollziehbar dokumentiert sind" ([BfDI statement, fn. 17][bfdi-2026]).
- Defence rights: where a decision basis is compiled by big data, algorithms and AI, it can only be checked if the procedures used and the evaluated data stocks are known; this implies inspection rights for affected persons and defence counsel ([BfDI statement, p. 21][bfdi-2026]).
- AI Act: AI used by law enforcement "to evaluate the reliability of evidence" is a high-risk use ([Annex III point 6(c)][aia-annex3]).
- Logs as evidence: logs under § 76 BDSG may be used for criminal proceedings ([§ 76 Abs. 3 BDSG][bdsg-76]; [Directive Art. 25(2)][led]).
- IT forensics: the BSI "Leitfaden IT-Forensik" (version 1.0.1) describes forensics as "methodisch vorgenommene Datenanalyse auf Datenträgern und Computernetzen zur Aufklärung von IT-Vorfällen" ([BSI][bsi-forensik]). Its requirements for evidence handling (integrity, documentation, repeatability, chain of custody) were **[not verified — the PDF was not opened]**.
- "Revisionssicher" is a term from commercial and tax record-keeping (GoBD), not from police or procedural law ([BMF, GoBD of 28 November 2019][gobd]) **[not verified — page not reachable; background knowledge]**.

### 4.2 BSI TR-03125 (TR-ESOR)

Source: [BSI TR-03125][tr-esor].

- Title: "Beweiswerterhaltung kryptographisch signierter Dokumente". Purpose: trustworthy storage of electronically signed data and documents for the whole retention period so that their evidentiary value is preserved.
- Current version 1.3. Reference architecture as middleware with the modules ArchiSafe (M.1), Krypto (M.2) and ArchiSig (M.3).
- Builds on Evidence Records under RFC 4998 and RFC 6283, qualified time stamps under eIDAS Art. 41 and 42, qualified preservation services under eIDAS Art. 34 and 40, and ETSI TS 119 511/512.
- Products can be certified (conformity tests TR-ESOR-C.1 and C.2).

### 4.3 BSI standards for public-sector systems

- **IT-Grundschutz-Kompendium:** Edition 2023, available since 1 February 2023, structured in modules across ten layers ([BSI][bsi-gs]).
- **Mindeststandard zur Protokollierung und Detektion von Cyberangriffen:** version 2.1 (November 2024); it concretises the Grundschutz modules OPS.1.1.5 (Protokollierung) and DER.1 (Detektion von sicherheitsrelevanten Ereignissen) for the federal communication technology and sets retention periods for log data. Its legal anchor moved from § 8 BSIG to § 44 BSIG with the NIS-2 implementation act in force since 6 December 2025 ([BSI][bsi-mst-pd]).
- **C5:** the Cloud Computing Compliance Criteria Catalogue sets minimum requirements for cloud services and is audited by independent auditors ([BSI][bsi-c5]). C5:2026 has been final since the end of March 2026; it is based on the EUCS "Substantial" requirements and adds container management, supply-chain management, post-quantum cryptography, confidential computing, tenant separation and the "technische Umsetzung von Souveränität" ([BSI][bsi-c5-2026]).
- **Classified information (VS-NfD):** under § 51 VSA all products that implement the basic security functions of § 52 VSA must be approved by the BSI when used to process, transmit or store classified information for federal or state authorities or their contractors. The approval states the highest classification level. For VS-NfD there is a "Qualifiziertes Zulassungsverfahren" with a list of qualified manufacturers ([BSI][bsi-zulassung]).

### 4.4 BSI guidance on AI

- **AIC4** (AI Cloud Service Compliance Criteria Catalogue): minimum requirements for machine learning in cloud services as an extension of C5; areas: security and robustness, performance and functionality, reliability, data quality, data management, explainability, bias. There is no certification; the BSI has deliberately not updated the catalogue while international work on test criteria continues ([BSI][bsi-aic4]). No formal successor is named on the page.
- Other current BSI AI documents ([BSI overview][bsi-ki]): criteria catalogue "QUAIDAL" for training-data quality (draft, six parts); "Kriterienkatalog des BSI zur Integration von extern bereitgestellten generativen KI-Modellen in eigene Anwendungen" (for federal agencies); "Generative KI-Modelle: Chancen und Risiken für Industrie und Behörden"; "Whitepaper Transparenz von KI-Systemen" (2024); "Whitepaper zu Bias in der künstlichen Intelligenz" (2025); "Erklärbarkeit von KI im adversarialen Kontext" (2025); "SBOM for AI – Minimum Elements" (G7); "A5" (AI Audit and Assurance Assessment Architecture); "Evasion-Attacks auf LLMs – Gegenmaßnahmen in der Praxis".

---

## 5. Digital sovereignty and procurement

### 5.1 The US CLOUD Act concern

- 18 U.S.C. § 2713 obliges providers to disclose data "within such provider's possession, custody, or control, regardless of whether such communication, record, or other information is located within or outside of the United States" (added by Pub. L. 115–141, 23 March 2018) ([Cornell LII][cloud-act]).
- The Federal Constitutional Court named the risk that, with software of private actors or other states, data is accessed or manipulated unnoticed by third parties ([Rn. 100][bverfg]).
- DSK: the state has a duty to protect police data against further use in third countries; access from and transfers to incompatible third countries must be excluded; as a rule only providers seated in the EEA reliably meet this ([DSK, 17 September 2025, no. 3][dsk-2025]).
- NRW data protection commissioner: risk of access by US authorities under the CLOUD Act and FISA to Palantir-based police systems ([netzpolitik.org][np-nrw]).
- State responses in contracts: Baden-Württemberg requires operation without internet connection in German data centres under police control and contractually excludes back doors and access by foreign authorities ([Interior Ministry BW][bw-im]).

### 5.2 Decisions and statements 2025–2026 preferring European, sovereign or open solutions

- Federal government, 7 July 2026: digital sovereignty of Germany and Europe "ist ... entschieden zu gewährleisten, indem Datenhoheit und Transparenz bei jeder IT-Lösung sichergestellt sind"; no commitment for or against a product ([BT-Drs. 21/7079][bt-21-7079]).
- Federal government, 20 March 2026: requirements in a later procurement would be defined product-neutrally ([BT-Drs. 21/4923][bt-21-4923]).
- DSK, 17 September 2025: EEA-seated providers, open systems that allow switching, and open-source-based tools in P20 ([DSK][dsk-2025]).
- Baden-Württemberg, 29 July 2025: Palantir as bridging technology; "Europa-VeRA" with Airbus Defence and Space and Schwarz Digits ([Interior Ministry BW][bw-im]); Greens' exit target 2030 ([netzpolitik.org][np-bw]).
- NRW, 10 July 2026: tender for a successor to the Palantir system is running ([NRW][nrw-pm]).
- BfV: reported choice of the French platform ArgonOS ([heise][heise-bfv]) **[not verified]**.
- IT-Planungsrat, November 2025: the EVB-IT were amended to explicitly allow open-source software ([Wikipedia, EVB-IT][evb-it-wiki]) **[not verified — secondary source]**.
- Sources disagree on Palantir: at the 2024 Bundestag hearing an expert of the Bavarian LKA called it currently the best available software, and the Baden-Württemberg interior minister calls it the "technologischen Marktführer"; the then BfDI favoured in-house development, and GFF warned against commercial providers ([Bundestag hearing 2024][bt-vera-2023]; [netzpolitik.org][np-bw]).

### 5.3 Deutschland-Stack, ZenDiS, openDesk, sovereign cloud

- **Deutschland-Stack:** "die nationale souveräne Technologie-Plattform" for digital projects. Technologies and standards should be trustworthy, sovereign, interoperable and compatible with European standards, on open international standards. Participation rounds ran from 1 October to 30 November 2025 and from 16 January to 15 February 2026 under the BMDS; concrete offerings for Federation, Länder and municipalities are to be developed by 2028. The criteria are guidance, not binding. A technology map is published ([deutschland-stack.gov.de][dstack]).
- **ZenDiS** (Zentrum für Digitale Souveränität der Öffentlichen Verwaltung): supports administrations in reducing dependence on a few large technology companies; offers the platform openCode, products such as openDesk and a "Souveränitätscheck". News items on its site in 2026: version 1.0 of criteria for digital sovereignty (10 October), openDesk as SaaS via govdigital on the Marktplatz Deutschland Digital (12 October), a paper on secure software supply chains mentioning the Deutschland-Stack (28 October), proof-of-concepts for agentic AI and air-gapped operation of openDesk ([zendis.de][zendis]).
- **openDesk:** office and collaboration suite for the public administration, developed by ZenDiS GmbH since January 2024 on behalf of the BMDS, integrating open-source components, with open standards and independence from a single operator ([opendesk.eu][opendesk]).
- **Deutsche Verwaltungscloud (DVC):** product of the IT-Planungsrat, steered by FITKO and operated by govdigital eG; aims at digital sovereignty through a federal multi-cloud infrastructure and "Wechselfähigkeit". About 70 DVC-compliant services are procurable via the Marktplatz Deutschland Digital; the programme DVC 2.0 runs from 2026 to 2029; a maturity model rates security, standardisation, sovereignty and interoperability ([deutsche-verwaltungscloud.de][dvc]).
- **C5:2026** includes criteria on the technical implementation of sovereignty ([BSI][bsi-c5-2026]).
- Commercial sovereign-cloud offers (Delos Cloud, STACKIT, IONOS, T-Systems, hyperscaler "sovereign" regions) could not be researched in this session **[not verified]**.

### 5.4 EVB-IT contract types

- The official overview is at [cio.bund.de][evb-it-cio] (not reachable in this session). The following is from [Wikipedia][evb-it-wiki] **[not verified against the official source]**:
  - EVB-IT are standard contract terms for IT procurement by the public sector; federal and state administrations must use them under their budget rules (e.g. administrative provisions to § 55 BHO).
  - Relevant types for Erda: **Überlassung Typ A** (standard software, one-time fee, unlimited use), **Überlassung Typ B** (standard software, periodic fee, limited term), **Pflege S** (maintenance of standard software), **Erstellung** (creating or adapting software), **System** (building an overall IT system including integration), **Systemlieferung** (system from standard components with minor adaptation), **Service**, **Dienstleistung**, **Cloud** (SaaS, IaaS, PaaS, managed cloud services), **Rahmenvereinbarung**.
  - No EVB-IT type for agile development exists. Specific EVB-IT terms for AI were not found.

### 5.5 Innovation partnership, SPRIND, Cyberagentur

- **Innovationspartnerschaft (§ 19 VgV):** for developing an innovative supply or service that is not yet available on the market and then acquiring it. Open call for requests to participate (minimum 30 days), negotiation of research and innovation projects, award not on lowest price alone, partnership with one or several partners. Structure: research and development phase and performance phase, with intermediate targets and payment in instalments; the contracting authority can terminate after each stage; purchase only if the agreed performance level and cost ceiling are met ([§ 19 VgV][vgv-19], version valid from 1 July 2026).
- **SPRIND** (Bundesagentur für Sprunginnovationen): federal agency (GmbH, Leipzig, founded 2019). The SPRIND-Freiheitsgesetz, in force since 29 December 2023, lets it act on federal mandate, hold stakes and use private-law funding instruments ([Wikipedia][sprind-wiki]) **[not verified — secondary source]**. Instruments on its site: Challenges and "Funken" (short competitions), strategic projects, open project submission; a "Funke Anti-Drone Response 2.0" on protecting civilian urban infrastructure is listed (12 November 2026) ([sprind.org][sprind]).
- **Cyberagentur:** commissions research for internal and external security; 109 million euros for research programmes in 2026; instruments are commissioned research, idea competitions (HAL2025, HAL2027), challenges and tenders ("Vergaben"). Programmes close to Erda: HEGEMON (evaluation of generative foundation models in security contexts), RSML (robust and secure machine learning), AI-as-OS, audio and image forensics ([cyberagentur.de][cyberagentur]).

---

## 6. Legal basis for civil-protection authorities to use drone and camera video

### 6.1 Rheinland-Pfalz — LBKG of 17 June 2025

Source: [LBKG, consolidated text valid from 27 June 2025, GVBl. 2025, 171][lbkg-2025]. The former § 39a of the 1981 act is now § 60.

- **§ 60 Abs. 1:** the use of unmanned aircraft systems under 25 kg by fire brigades and aid organisations, or under supervision of the responsible bodies, is permitted in particular for: reconnaissance of the situation picture and command support; operational documentation; hazardous-substance measurement; search for persons and animals in danger; transport of equipment and medicines; documentation and evaluation of exercises.
- **§ 60 Abs. 2:** "Bild- und Tonaufzeichnungen, bei denen schutzwürdige Interessen der erfassten Personen betroffen werden oder bei denen öffentlich zugängliche Räume betroffen sind, sind nur zulässig, soweit dies im Einzelfall zur Abwehr einer Gefahr geboten ist." In all other cases, especially exercises, residential properties and public areas may be overflown only with consent, or if unavoidable for the exercise and all precautions are taken, in particular no recordings.
- **Deletion:** stored recordings with personal content must be deleted as soon as they are no longer needed; "Die Löschung hat spätestens nach zwei Monaten zu erfolgen", unless longer storage is exceptionally required to assert, exercise or defend legal claims in criminal, administrative-offence, civil or administrative proceedings. Use for training where protected interests are affected only with consent.
- **§ 59:** processing of personal data for fire and disaster protection, including preparation and execution of preventive and defensive measures and alarm and deployment plans (Abs. 1); transfer to other authorities, among other things for the prosecution of offences (Abs. 3); emergency calls may be recorded (Abs. 4); control-centre recordings are as a rule deleted after six months (Abs. 5); reference to the state data protection act (Abs. 6).
- **[reading]** § 60 regulates recording and deletion. It says nothing on automated or AI-based analysis of the footage.

### 6.2 North Rhine-Westphalia — BHKG

- § 46 BHKG ("Verarbeitung personenbezogener Daten"): GDPR and DSG NRW apply; the responsible authorities and participating organisations may process personal data to prepare and carry out preventive and defensive measures, including special categories in conjunction with § 16 DSG NRW; information duties are restricted; anonymised use for statistics, evaluation and training; non-anonymised control-centre recordings must be deleted "spätestens nach sechs Monaten", radio records after three months, data of information points after one month; data to be retained longer must be blocked ([§ 46 BHKG, mirror][bhkg-46]). The provision does not mention drones or image recordings.
- The NRW government names § 46 BHKG as the specific rule for drone use in disaster control and sees no need for further legislation ([Drs. 18/10805][nrw-18-10805]).

### 6.3 Other Länder

- Thuringia: the fire and disaster protection act contains no data protection rules for drone footage; the tasks in §§ 3, 6, 7 ThürBKG combined with Art. 6(1)(e), (3) GDPR and § 16 ThürDSG can be the basis, to be checked in each case; Art. 6(1)(d) GDPR for floods and similar disasters ([TLfDI, p. 6][tlfdi-drohnen]).
- Lower Saxony: a bill provided specific bases for drones of fire brigades and disaster control with restrictions on recordings ([Landtag Niedersachsen, Drs. 19/2714][nds-lt]) **[not verified — search-result summary; enactment not checked]**.
- Bavaria: no sufficient basis in the general data protection clause for municipal drone flights over homes (section 3.5).

### 6.4 Air law — § 21k LuftVO

- § 21k LuftVO ("Betrieb von unbemannten Fluggeräten durch Behörden und Organisationen mit Sicherheitsaufgaben"): operation of unmanned aircraft under 25 kg is exempt from the authorisation requirement of Art. 12 of Implementing Regulation (EU) 2019/947 if carried out by or under supervision of (1) authorities, where it serves their tasks, or (2) organisations with security tasks in connection with emergencies, accidents and disasters. §§ 21h and 21i do not apply; no remote-identification add-on is required for statutory tasks. Version in force since 18 June 2021 ([§ 21k LuftVO, mirror][luftvo-21k]; official: [gesetze-im-internet.de][luftvo-21k-off]).
- Scope: according to a communication of the Federal Ministry for Digital and Transport of 20 July 2022, only authorities and organisations with security tasks in the narrow sense are covered — police forces, THW, customs, fire brigades, rescue services, disaster and civil protection authorities including participating aid organisations. All other authorities are not ([Drs. 18/10805, answer 5][nrw-18-10805]).
- § 21k does not distinguish whether a camera is used and is not a data protection basis ([Drs. 18/10805, answers 4–5][nrw-18-10805]).
- The EU drone regulation (EU) 2018/1139 does not apply to police, search and rescue, firefighting and similar services (Art. 2(3)) ([TLfDI, p. 4][tlfdi-drohnen]).
- The BBK "Empfehlungen für gemeinsame Regelungen zum Einsatz von Drohnen im Bevölkerungsschutz" (EGRED 2) were last updated in February 2024 ([Drs. 18/10805, preliminary remark][nrw-18-10805]).

---

## 7. Open points

- Final text and fate of the federal bills 21/6131, 21/6132, 21/6806 after the hearing of 21 September 2026.
- Official wording of § 25a HSOG, of the new NRW power and of the Baden-Württemberg power.
- Docket number and reasons of the Federal Constitutional Court's February 2026 non-admission of the NRW complaint.
- Whether Art. 49(2) AI Act (registration of systems exempted under Art. 6(3)) was changed in substance by Regulation (EU) 2026/1744.
- Final Commission guidelines on high-risk classification.
- General-purpose AI model obligations (Chapter V AI Act) for the open-weights vision-language model used inside Erda — not researched.
- Official EVB-IT list and any AI-specific EVB-IT terms.
- Sovereign-cloud offers and their BSI attestations.
- Legal bases in the remaining Länder for civil-protection video, and any explicit basis for AI analysis of such video.
- Rules for traffic and infrastructure cameras (road authorities, municipal utilities) as data sources — not researched.

---

## 8. Requirement → source → product feature

| # | Requirement | Source | Product feature that answers it |
|---|---|---|---|
| 1 | No real-time remote biometric identification in public spaces; no face databases from untargeted scraping. | AI Act [Art. 5(1)(h), (e)][aia-5]; [recital 17][aia-r17]; BVerfG [Rn. 87][bverfg] (excluding biometric data mitigates) | No face recognition and no licence-plate recognition in the product; no matching of persons against any reference database. |
| 2 | No biometric categorisation by sensitive attributes. | AI Act [Art. 5(1)(g)][aia-5]; [recital 16][aia-r16]; [Annex III 1(b)][aia-annex3] | Query policy that rejects searches inferring ethnicity, religion, political opinion, sexual orientation; person queries limited to non-bodily descriptors and logged. |
| 3 | No person-related risk prediction, no automated decisions. | AI Act [Art. 5(1)(d)][aia-5]; Directive 2016/680 [Art. 11][led]; BVerfG [Rn. 98][bverfg]; [Art. 61a Abs. 5 PAG][pag-61a] | Output is retrieved footage for human assessment; no person scores; no automatic measures triggered. |
| 4 | Every analysis needs a stated reason tied to a legal task. | BVerfG [Rn. 108–109][bverfg] ("eigenständig ausformulierte Begründungen"); Directive [Art. 25(1)][led]; [§ 76 Abs. 2 BDSG][bdsg-76]; GDPR [Art. 5(1)(b)][gdpr-5] | Mandatory mandate field (legal basis, operation or case number, purpose) before a query or alert can run. |
| 5 | Search driven by a search term and a cause, not open-ended pattern mining. | BVerfG [Rn. 93–94, 108][bverfg]; [Art. 61a Abs. 4 PAG][pag-61a] (only hits matching search parameters); [§ 98e StPO-E][bt-kw28] (manual, case-related trigger) | Query-based retrieval; standing alerts bound to mandate, area and expiry date; no unsupervised anomaly search on persons. |
| 6 | Log every consultation with reason, time, user and recipient. | Directive [Art. 25][led]; [§ 76 BDSG][bdsg-76]; AI Act [Art. 12][aia-12], [Art. 26(6)][aia-26] (keep at least six months); [Art. 61a Abs. 4 Satz 5 PAG][pag-61a] | Append-only, hash-chained log of every query, alert, unmasking and export; configurable retention per legal regime. |
| 7 | Logs must show what was matched, otherwise control is impossible. | [BfDI statement, p. 12][bfdi-2026] | Log entry stores query text, sources searched and identifiers of returned segments. |
| 8 | Independent control by data protection officers, also by random samples. | BVerfG [Rn. 109, Leitsatz 5][bverfg]; [§ 76 Abs. 3, 5 BDSG][bdsg-76]; Directive [Art. 25(3)][led] | Auditor role with read-only access to logs and sampling tools; export for the supervisory authority. |
| 9 | Access only for few qualified staff; separation of duties. | BVerfG [Rn. 117][bverfg]; [§ 64 Abs. 3 BDSG][bdsg-64]; [§ 48 Abs. 2 BDSG][bdsg-48]; [Art. 61a Abs. 4 PAG][pag-61a] | Role model (operator, supervisor, auditor, administrator); administrators cannot query; auditors cannot change data. |
| 10 | Data minimisation by design and by default. | GDPR [Art. 25][gdpr-25], [Art. 5(1)(c)][gdpr-5]; [§ 71 BDSG][bdsg-71]; Directive [Art. 20][led]; [LfDI RLP][lfdi-rlp-drohnen] (automatic pixelation) | Faces masked by default; unmasking only with reason, second approval and log entry. |
| 11 | Masked footage stays personal data. | [TLfDI, p. 5][tlfdi-drohnen] (clothing, gait, figure, hair colour, objects, plates) | All safeguards apply to masked footage as well; no "anonymous mode" claim. |
| 12 | Storage limitation and fixed deletion periods. | GDPR [Art. 5(1)(e)][gdpr-5]; Directive [Art. 5][led]; [§ 60 Abs. 2 LBKG][lbkg-2025] (drone recordings: two months); [§ 59 Abs. 5 LBKG][lbkg-2025], [§ 46 BHKG][bhkg-46] (control-centre recordings: six months); [§ 4 Abs. 5 BDSG][bdsg-4]; [§ 76 Abs. 4 BDSG][bdsg-76] (logs: end of the following year) | Retention policy per source and state law; automatic deletion of footage and index; legal hold for proceedings. |
| 13 | No central data stock without a purpose. | [BfDI statement, p. 14–16][bfdi-2026] ("Super-Datenbank"); BVerfG [Leitsatz 2, Rn. 78][bverfg] | Federated architecture: raw video and index stay with the owning agency; cross-agency search per query and mandate only. |
| 14 | Keep purposes and origins apart; mark data from intrusive measures. | BVerfG [Rn. 118][bverfg]; [BfDI statement, p. 16][bfdi-2026]; Directive [Art. 6][led]; GDPR Art. 6(4) per [TLfDI, p. 7][tlfdi-drohnen] | Every source carries labels for owner, legal basis, purpose and sensitivity; the policy engine decides which sources a mandate may search. |
| 15 | No self-learning in operation; limits on learning must be explicit. | BVerfG [Rn. 100, 121][bverfg]; [Art. 61a Abs. 5 PAG][pag-61a]; [BfDI statement, p. 19][bfdi-2026] | Frozen model weights in production; no training on customer data without separate authorisation; model version recorded in each log entry. |
| 16 | Software must be inspectable; no hidden access or manipulation by third parties. | BVerfG [Rn. 100, 102, 109][bverfg] ("staatliches Monitoring"); [DSK 2025, no. 3–4][dsk-2025]; AG Reutlingen via [BfDI, fn. 17][bfdi-2026] | Open model weights, documented algorithm, reference data and quality parameters; reproducible builds; software bill of materials. |
| 17 | No access from third countries; provider under European law. | [DSK 2025, no. 3][dsk-2025]; [18 U.S.C. § 2713][cloud-act]; [BT-Drs. 21/7079, answer 4][bt-21-7079]; [Interior Ministry BW][bw-im] | On-premises and air-gapped operation in the agency's data centre; no telemetry; EEA-seated supplier. |
| 18 | Ability to switch supplier. | [DSK 2025, no. 3][dsk-2025] ("hinreichend offen"); [DVC][dvc] ("Wechselfähigkeit"); [Deutschland-Stack][dstack] (open standards) | Open interfaces and export formats for footage, index metadata and logs. |
| 19 | Effective human oversight and awareness of automation bias. | AI Act [Art. 14][aia-14], [Art. 26(2)][aia-26]; Directive [Art. 11][led] | Results shown as candidates with confidence and source frame; confirmation step before any follow-up action; stop switch for alerts. |
| 20 | Declared accuracy, robustness, error detection and correction. | AI Act [Art. 9][aia-9], [Art. 15][aia-15]; BVerfG [Rn. 102][bverfg] | Published evaluation results per model version; false-hit reporting and correction workflow; adversarial-robustness tests. |
| 21 | Impact assessments before use. | GDPR [Art. 35(3)(c)][gdpr-35]; [§ 67 BDSG][bdsg-67]; Directive [Art. 27, 28][led]; AI Act [Art. 27][aia-27], [Art. 26(9)][aia-26] | Template pack for data protection and fundamental rights impact assessments, pre-filled with system description, risks and measures. |
| 22 | Transparency towards the public; published rules of use. | BVerfG [Leitsatz 5][bverfg]; GDPR Art. 13 per [TLfDI, p. 8][tlfdi-drohnen]; [§ 4 Abs. 2 BDSG][bdsg-4] | Exportable, publishable policy configuration (sources, roles, retention); notice templates; periodic usage statistics. |
| 23 | Security of processing according to BSI standards. | [§ 64 BDSG][bdsg-64]; Directive [Art. 29][led]; [IT-Grundschutz][bsi-gs]; [BSI minimum standard on logging][bsi-mst-pd]; [C5:2026][bsi-c5-2026]; [VSA approval][bsi-zulassung] | Deployment profile mapped to IT-Grundschutz modules; encryption at rest and in transit; use of BSI-approved components where classified data is processed. |
| 24 | Recording by drones only for averting danger; exercises without recording. | [§ 60 Abs. 2 LBKG][lbkg-2025]; [TLfDI, p. 7][tlfdi-drohnen] | Operation mode per source ("incident" vs. "exercise"); exercise mode blocks ingestion or forces full pixelation. |
| 25 | Evidence must be traceable and its integrity provable. | [§ 371a ZPO][zpo-371a]; [BSI TR-03125][tr-esor]; AG Reutlingen via [BfDI, fn. 17][bfdi-2026]; AI Act [Annex III 6(c)][aia-annex3] | Evidence export with original segment, hash value, signed manifest, time stamp, model version and the related log excerpt; interface to a TR-ESOR-conformant archive. |
| 26 | Registration and conformity when a use is high-risk. | AI Act [Art. 16][aia-16], [Art. 49][aia-49], [Art. 113][aia-113] (2 December 2027), [Art. 111(2)][omnibus] (2 August 2030) | Intended-purpose statement per customer segment; technical documentation and quality management prepared for conformity assessment. |

---

[bverfg]: https://www.bundesverfassungsgericht.de/e/rs20230216_1bvr154719.html
[bverfg-pm]: https://www.bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/DE/2023/bvg23-018.html
[dsk-2023]: https://www.datenschutz-bayern.de/dsbk-ent/DSK_105-Datenanalyse-Polizei.pdf
[dsk-2025]: https://datenschutzkonferenz-online.de/media/en/2025-09-17_DSK-Entschliessung_Automatisierte-Datenanalyse.pdf
[bfdi-2026]: https://www.bundestag.de/resource/blob/1210152/21-4-179-Stellungnahme-BfDI-Bonn-digitale-Ermittlungsbefugnisse-21-6131-21-6132-o-U.pdf
[bt-21-4923]: https://dserver.bundestag.de/btd/21/049/2104923.pdf
[bt-21-7079]: https://dserver.bundestag.de/btd/21/070/2107079.pdf
[bt-kw28]: https://www.bundestag.de/dokumente/textarchiv/2026/kw28-de-strafprozessordnung-1192534
[bt-vera-2023]: https://www.bundestag.de/dokumente/textarchiv/2023/kw48-de-software-bundes-vera-979672
[br-58-25]: https://dserver.bundestag.de/brd/2025/0058-25B.pdf
[breg-kabinett]: https://www.bundesregierung.de/breg-de/schwerpunkte/wirksam-regieren/kabinett-digitale-ermittlungsbefugnisse-2304936
[np-faq]: https://netzpolitik.org/2026/faq-das-ueberwachungspaket-der-bundesregierung/
[gff-overview]: https://freiheitsrechte.org/en/themen/freiheit-im-digitalen-zeitalter/automatisierte-datenanalyse
[gff-bayern]: https://freiheitsrechte.org/themen/freiheit-im-digitalen-zeitalter/palantir-bayern
[gff-hsog-vb]: https://freiheitsrechte.org/uploads/documents/Freiheit-im-digitalen-Zeitalter/Polizeigesetz-Hessen/Verfassungsbeschwerdeschrift-HSOG.pdf
[ccc-hsog]: https://www.ccc.de/system/uploads/381/original/HSOG-bverfg.pdf
[hrrs]: https://www.hrr-strafrecht.de/hrr/archiv/26-01/index.php?sz=6
[gruene-stgh]: https://www.gruene-hessen.de/landtag/wp-content/blogs.dir/2/files/2025/06/Normenkontrollantrag-StGH-Hessen-Endfassung-28.05.2025_1.pdf
[pag-61a]: https://www.gesetze-bayern.de/Content/Document/BayPAG-61a
[pag-61a-mirror]: https://lxgesetze.de/pag/61a
[bay-lt-7043]: https://www.bayern.landtag.de/www/ElanTextAblage_WP19/Drucksachen/Schriftliche%20Anfragen/19_0007043.pdf
[drds-vera]: https://www.dr-datenschutz.de/vera-die-neue-polizei-software-in-bayern/
[beck-gff]: https://www.beck-aktuell.de/daily/meldung/detail/verfassungsbeschwerde-regeln-pag-polizei-software-palantir-datenschutz
[nrw-pm]: https://www.land.nrw/pressemitteilung/ueberbrueckungsvertrag-polizei-nordrhein-westfalen-behaelt-aktuelle-datenanalyse
[np-nrw]: https://netzpolitik.org/2026/automatisierte-datenanalyse-in-nrw-palantir-gesetz-nicht-verfassungskonform/
[vb-palantir]: https://verfassungsblog.de/palantir-gesetzgebung/
[bw-im]: https://im.baden-wuerttemberg.de/de/service/presse-und-oeffentlichkeitsarbeit/pressemitteilung/pid/landesregierung-gibt-ermittlungsbehoerden-neue-instrumente-an-die-hand
[np-bw]: https://netzpolitik.org/2025/baden-wuerttemberg-gruene-geben-polizeidaten-fuer-palantir-frei/
[heise-bfv]: https://heise.de/-11293717
[winfuture-bfv]: https://winfuture.de/news,158699.html
[ag-reutlingen]: https://www.landesrecht-bw.de/bsbw/document/NJRE001637569
[aia-oj]: https://eur-lex.europa.eu/eli/reg/2024/1689/oj
[omnibus]: https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng
[omnibus-explorer]: https://artificialintelligenceact.eu/ai-act-explorer/digital-omnibus/
[omnibus-proposal]: https://digital-strategy.ec.europa.eu/en/library/digital-omnibus-ai-regulation-proposal
[aia-2]: https://artificialintelligenceact.eu/article/2/
[aia-3]: https://artificialintelligenceact.eu/article/3/
[aia-5]: https://artificialintelligenceact.eu/article/5/
[aia-6]: https://artificialintelligenceact.eu/article/6/
[aia-9]: https://artificialintelligenceact.eu/article/9/
[aia-10]: https://artificialintelligenceact.eu/article/10/
[aia-12]: https://artificialintelligenceact.eu/article/12/
[aia-14]: https://artificialintelligenceact.eu/article/14/
[aia-15]: https://artificialintelligenceact.eu/article/15/
[aia-16]: https://artificialintelligenceact.eu/article/16/
[aia-26]: https://artificialintelligenceact.eu/article/26/
[aia-27]: https://artificialintelligenceact.eu/article/27/
[aia-49]: https://artificialintelligenceact.eu/article/49/
[aia-74]: https://artificialintelligenceact.eu/article/74/
[aia-113]: https://artificialintelligenceact.eu/article/113/
[aia-annex3]: https://artificialintelligenceact.eu/annex/3/
[aia-r16]: https://artificialintelligenceact.eu/recital/16/
[aia-r17]: https://artificialintelligenceact.eu/recital/17/
[hr-guidelines-draft]: https://www.dlapiper.com/en/insights/publications/2026/06/eu-commission-draft-guidelines-on-classification-of-high-risk-ai-systems-key-points
[bnetza-kimig]: https://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/DE/2026/20260729_KI_VO.html
[gdpr-5]: https://gdpr-info.eu/art-5-gdpr/
[gdpr-6]: https://gdpr-info.eu/art-6-gdpr/
[gdpr-9]: https://gdpr-info.eu/art-9-gdpr/
[gdpr-25]: https://gdpr-info.eu/art-25-gdpr/
[gdpr-35]: https://gdpr-info.eu/art-35-gdpr/
[led]: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016L0680
[bdsg-4]: https://dsgvo-gesetz.de/bdsg/4-bdsg/
[bdsg-45]: https://dsgvo-gesetz.de/bdsg/45-bdsg/
[bdsg-48]: https://dsgvo-gesetz.de/bdsg/48-bdsg/
[bdsg-64]: https://dsgvo-gesetz.de/bdsg/64-bdsg/
[bdsg-67]: https://dsgvo-gesetz.de/bdsg/67-bdsg/
[bdsg-71]: https://dsgvo-gesetz.de/bdsg/71-bdsg/
[bdsg-76]: https://dsgvo-gesetz.de/bdsg/76-bdsg/
[bdsg-76-off]: https://www.gesetze-im-internet.de/bdsg_2018/__76.html
[tlfdi-drohnen]: https://www.tlfdi.de/fileadmin/tlfdi/datenschutz/Kommunales/2103_Orientierungshilfe_Drohnen.pdf
[lfdi-rlp-drohnen]: https://www.datenschutz.rlp.de/themen/videoueberwachung/videoueberwachung-mit-drohnen
[lfd-nds-faq]: https://www.lfd.niedersachsen.de/faq/videouberwachung/faq-videouberwachung-175245.html
[nrw-18-10805]: https://www.landtag.nrw.de/portal/WWW/dokumentenarchiv/Dokument/MMD18-10805.pdf
[bayvgh-pm]: https://verwaltungsgerichtsbarkeit.bayern.de/mam/gerichte/bayvgh/presse/pressemitteilung_bayvgh_drohnenbefliegung.pdf
[bayvgh]: https://www.gesetze-bayern.de/Content/Document/Y-300-Z-BECKRS-B-2024-N-2968
[bverwg]: https://www.bverwg.de/pm/2019/22
[edpb-video]: https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_201903_video_devices_en.pdf
[dsk-kp5]: https://www.datenschutzkonferenz-online.de/media/kp/dsk_kpnr_5.pdf
[dsk-drohnen]: https://www.datenschutzkonferenz-online.de/media/oh/20190116_oh_positionspapier_kameradrohnen.pdf
[dsk-oh-ki]: https://www.datenschutz-bayern.de/dsbk-ent/DSK_OH_KI_und_Datenschutz.pdf
[dsk-oh-ki-tom]: https://datenschutzkonferenz-online.de/media/oh/DSK-OH_KI-Systeme.pdf
[dsk-gesicht]: https://www.datenschutzkonferenz-online.de/media/en/2024-09-20_Entschliessung_DSK_Gesichtserkennung.pdf
[lda-bb-dsfa]: https://www.lda.brandenburg.de/sixcms/media.php/9/DSFA_Muss_Liste_oeffentlich_21062019.pdf
[stpo-261]: https://www.gesetze-im-internet.de/stpo/__261.html
[zpo-371a]: https://www.buzer.de/371a_ZPO.htm
[gobd]: https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2019-11-28-GoBD.html
[tr-esor]: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Technische-Richtlinien/TR-nach-Thema-sortiert/tr03125/TR-03125_node.html
[bsi-gs]: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/IT-Grundschutz-Kompendium/it-grundschutz-kompendium_node.html
[bsi-mst-pd]: https://www.bsi.bund.de/DE/Themen/Oeffentliche-Verwaltung/Mindeststandards/PDCA/PDCA_node.html
[bsi-c5]: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Empfehlungen-nach-Angriffszielen/Cloud-Computing/Kriterienkatalog-C5/kriterienkatalog-c5_node.html
[bsi-c5-2026]: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Empfehlungen-nach-Angriffszielen/Cloud-Computing/Kriterienkatalog-C5/C5_2025/C5_2025_node.html
[bsi-zulassung]: https://www.bsi.bund.de/DE/Themen/Oeffentliche-Verwaltung/Zulassung/zulassung_node.html
[bsi-forensik]: https://www.bsi.bund.de/DE/Themen/Oeffentliche-Verwaltung/Sicherheitspruefungen/IT-Forensik/forensik_node.html
[bsi-aic4]: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Kuenstliche-Intelligenz/AIC4/aic4_node.html
[bsi-ki]: https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Informationen-und-Empfehlungen/Kuenstliche-Intelligenz/kuenstliche-intelligenz_node.html
[cloud-act]: https://www.law.cornell.edu/uscode/text/18/2713
[dstack]: https://deutschland-stack.gov.de/
[zendis]: https://www.zendis.de/
[opendesk]: https://www.opendesk.eu/de
[dvc]: https://www.deutsche-verwaltungscloud.de/
[evb-it-cio]: https://www.cio.bund.de/Webs/CIO/DE/digitale-loesungen/it-beschaffung/evb-it-und-bvb/evb-it-und-bvb-node.html
[evb-it-wiki]: https://de.wikipedia.org/wiki/EVB-IT
[vgv-19]: https://www.buzer.de/19_VgV.htm
[sprind]: https://www.sprind.org/
[sprind-wiki]: https://de.wikipedia.org/wiki/Bundesagentur_f%C3%BCr_Sprunginnovationen
[cyberagentur]: https://www.cyberagentur.de/
[lbkg-2025]: https://lfbk.rlp.de/fileadmin/lfbk/Service/Dokumente/LBKG_Ausgabe_17Juni2025.pdf
[bhkg-46]: https://lexmea.de/de/gesetz/bhkg-nrw/46
[nds-lt]: https://www.landtag-niedersachsen.de/drucksachen/drucksachen_19_05000/02501-03000/19-02714.pdf
[luftvo-21k]: https://www.buzer.de/s1.htm?a=21k&g=LuftVO&dorg=1
[luftvo-21k-off]: https://www.gesetze-im-internet.de/luftvo_2015/__21k.html
