# Sicht – speaker notes for the presentation (English edition)

Two to four sentences per slide. The same texts are the notes inside the presentation.
Text in square brackets is a reminder for the speaker and is not spoken.

## 01 · Title

Sicht is German for sight, and a word every responder there knows: “Wir haben Sicht”, we have sight, means the situation has been grasped. Today I am showing you a running system at trial stage, with exercise material and without government customers. The tagline is the product promise: every analysis has a purpose, a responsible person and a ledger entry. In German it reads “Keine Sicht ohne Aufsicht”.

## 02 · Ahr valley, 14 July 2021, 22:14

I pin the problem to this case, the flood in the Ahr valley in Germany in July 2021. It is documented that the helicopter filmed and that the videos were not properly filed; the parliamentary inquiry and the prosecutors knew nothing of them until September 2022. No source shows whether the footage reached the incident command, so I do not claim it. The footage existed; an operating picture made from it did not. The quotation on the slide is our translation from German.

## 03 · Pattern: two more documented cases

Two more officially documented cases. In Los Angeles the county’s report records that real-time information could not be shared consistently; on Maui about 850 gigabytes of material were released afterwards. I explicitly do not say that software would have changed the course of either. I say: the path from image to awareness is the weak point.

## 04 · Timing: Germany’s digital operating picture

The German federal government is building a digital operating picture together with the states, and in 2027 the decision on live operation is due. Whoever is not known as a supplier by then will not get into the first stage. The ten billion euros are funds already budgeted, not a pot one applies to. And frankly: no authority has so far asked for image search in the operating picture. BMI is the Federal Ministry of the Interior, BBK the Federal Office of Civil Protection and Disaster Assistance, THW the Federal Agency for Technical Relief. The quotations are our translation from German.

## 05 · What Sicht is

Sicht is the image layer for the civil operating picture, not another command and control system. The purpose is measurable: the time from the first image of an event to the alert on the situation map, and the system reports it itself in every exercise. On the status: recordings are the tested path; live streams run with a delay of about half a minute and have been tested only in the lab.

## 06 · Übersicht – overview: the situation on one map

This is the main screen during the exercise RHEIN-MOSEL: eleven sources, each with its location. The exercise replays recordings analysed in advance on a clock, as if they were arriving right now. On the right the alerts come in and are merged into incidents; two sources for the same event count as corroboration. The module is called Übersicht, German for overview. The console is bilingual: this screenshot shows it in English, the following ones in German.

## 07 · Vorsicht – watches: they alert on their own

A watch is a standing query in words, not a trained model. In the exercise one watch makes a mistake, and I show it instead of hiding it. The analyst dismisses the alert, confirms the correct one and explicitly retrains the watch; the step is in the ledger and can be taken back. In the next run the false alert does not return, and the real accident is still reported. The module is called Vorsicht, German for caution.

## 08 · Einsicht – search: in your own words

Searches are made in whole phrases, in German or English; the image model runs offline on the authority’s machine. Names, faces, licence plates, origin and bodily features are refused, and the refusal is recorded. The check is a traceable check of words and can be circumvented by paraphrase; that is what the ledger and the sample are for. The module is called Einsicht, German for insight. The query on the screen, “überflutete Wiese”, means flooded meadow.

## 09 · Weitsicht – federation: only questions travel

Every authority runs its own node. In the federation only the question travels; the peer checks it against its own rules, records it and returns masked previews with a receipt number. In my research I found this principle at no vendor; that is a hypothesis from a limited search. In the demonstration the three nodes run on one machine; a federation across a real network has not been measured. The module is called Weitsicht, German for far sight.

## 10 · Aufsicht – ledger: a log that can be verified

Every sign-in, query, refusal and approval is in a chained ledger. Whoever changes an entry breaks the chain, and the verification shows where. That can be recomputed without our software: two short verifiers come with the export. Oversight has a role of its own: it sees the ledger and the measurements, but no footage. One limitation belongs here: sign-in and rights are built for the demonstration, with three fixed accounts. The module is called Aufsicht, German for oversight.

## 11 · Rücksicht – protection: masking and four eyes

Faces are pixelated at ingest. Whoever needs the original states the reason and obtains the approval of a second person in a supervising role; it is valid for 15 minutes and recorded in the ledger. No one can approve their own request. How many faces the detector misses has not been measured. The module is called Rücksicht, German for consideration.

## 12 · Measurements: one exercise, two caveats

Measured on a machine with four cores and no graphics card, and repeatable with one command. 13 of the 13 events of the script were reported, at a median of 1.1 seconds after the arrival of the analysed frame, with one false alert; with a live stream a delay of about half a minute is added. Two caveats belong to every one of these figures: the watches were worded on this footage, and the hazard model errs on it despite 99 per cent on its benchmark. The figures say nothing about quality on real operational footage. [With an accelerated exercise clock the WIRKUNG tab reports higher values, two to three seconds at 8×; the 1.1 s come from the measurement run in real time.]

## 13 · Limits: what Sicht is not meant to do

These limits are a selling point, not a concession: no faces, no licence plates, no search by origin or bodily features, no central data pool. I am precise about it: some of it is architecture, for instance that there is no model for faces and that recordings do not leave the node. The rest is a rule with a ledger, for instance the query check, and that is what I call it.

## 14 · Competition: the open space is narrow

I do not say that nobody can do this: more than ten vendors ship free-text search over video, and the German state of Baden-Württemberg runs an operating picture by Fraunhofer. Palantir does not solve the task as a product, but could build it from its own building blocks. What I found at no vendor is the principle that in a federation only the question travels; that is the result of a limited search, not proof. Sicht therefore positions itself as an image layer that connects to existing systems.

## 15 · Buyers: the path to the first trial

There are buyers at three levels of the German state. The realistic path starts from below: a paid trial in an exercise at a county with its own drone unit, with a measurement report as the result. Then a second state, then a framework agreement. I have set myself a stop criterion: if no authority commits to a trial by the end of March 2027, the demand thesis is wrong. BBK is the Federal Office of Civil Protection and Disaster Assistance, THW the Federal Agency for Technical Relief.

## 16 · Business model: licence per node and year

What is sold is a licence per node and year; the node runs on the authority’s machines. All prices are assumptions; I found no comparable prices for staff software. Calculating Germany bottom-up gives about 25 million euros a year at full coverage. That is a small core market, and I would rather say so myself.

## 17 · Five-year case: base case and its assumptions

This is the base case from the workbook; every input is an assumption and can be changed in one cell. Revenue in 2031 about 2.3 million euros, first positive operating result in 2031, funding need until then about 3.2 million. The case hinges on a single state framework agreement in 2030; without it things look considerably worse. In the cautious case the business does not carry itself by 2031.

## 18 · Risks: six points and the countermeasures

The largest risk is legal: there is no explicit legal basis for the AI analysis of video in civil protection. The second are the incumbents, who can add the feature. On top come long sales cycles, evidence only from stock footage and the lab, an unchecked name and a single founder without a background in staff work. For each point, the right-hand column says what I do about it. DPMA is the German Patent and Trade Mark Office, EUIPO the European Union Intellectual Property Office.

## 19 · Status: what runs, what is missing, the ask

You have seen what runs. Live streams are built and tested in the lab, with a delay of about half a minute; they have not been tried in the field. A second reader has gone through the source code: 21 findings, the severe ones are fixed, a penetration test is still to come. My request is concrete: an authority that trials Sicht in an exercise for three months and receives a measurement report for it. [Decide before the meeting whether to ask for financing; the slide deliberately names the need of the base case and no sum asked for.]

## 20 · Close

No sight without oversight: that is the sentence you can measure me by. I would be glad to show you the system in operation now. I answer questions directly, the uncomfortable ones too.
