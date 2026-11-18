/*
 * English text of the page. The German text lives in index.html and is the original;
 * main.js swaps element contents by the key in their data-i18n attribute.
 * Values may contain markup. Footnote anchors must keep their ids (r1…r5, q1…q5).
 * The screenshots show the German console; captions name its tabs as they appear there.
 */
window.SICHT_EN = {
  'doc.title': 'Sicht — No sight without oversight.',
  'doc.description':
    'Sicht makes the video that authorities record during operations anyway searchable within seconds and watches it for hazards on its own. Without identifying people, without pooling data, with a ledger that accounts for every query.',

  skip: 'Skip to content',
  'bar.home': 'Sicht – back to top',
  'bar.sections': 'Sections',
  'bar.contents': 'Contents',
  'bar.language': 'Language',
  'nav.problem': 'Problem',
  'nav.produkt': 'Product',
  'nav.arbeitsweise': 'Method',
  'nav.verbund': 'Federation',
  'nav.grenzen': 'Limits',
  'nav.gemessen': 'Measured',
  'nav.betrieb': 'Operation',
  'nav.stand': 'Status',
  cta: 'Request a demonstration',

  // ---------------------------------------------------------------- hero
  'hero.kicker': 'The image layer for the civil operating picture',
  'hero.h1': 'No sight <br>without oversight.',
  'hero.lede':
    'Sicht makes the video that authorities record during operations anyway – from drones, helicopters, gauge and traffic cameras, vehicles – searchable within seconds and watches it for hazards on its own. Without identifying people, without pooling data, and with a ledger that accounts for every query.',
  'hero.go1': 'See the product',
  'hero.go2': 'What Sicht cannot do',
  'hero.r1k': 'Area',
  'hero.r1v': 'Rhine / Moselle · Koblenz',
  'hero.r2k': 'MGRS',
  'hero.r3k': 'Footage',
  'hero.r3v': 'Exercise · no operational data',
  'hero.r4k': 'Map',
  'map.attrib': '© OpenStreetMap contributors (ODbL) · OpenMapTiles · Elevation: Mapzen',

  // ---------------------------------------------------------------- film
  'film.rail': 'Film · 40 s',
  'film.h2': 'Brand film',
  'film.aria': 'Brand film, 40 seconds, with sound, no voice-over',
  'film.fallback': 'Open the film as a file (MP4, 2.8 MB)',
  'film.caption': 'Brand film · symbolic images, AI-generated',
  'film.note':
    '40 seconds, with sound, no voice-over; the text cards are in German. What the film says about the flood night in the Ahr valley is set out with sources in the next section.',

  // ---------------------------------------------------------------- 01 problem
  'problem.h2': 'The footage existed.<br>The picture did not.',
  'problem.intro': 'Three records showing that what is missing is not the recording, but the path from image to awareness.',
  'fact1.where': 'Ahr valley, Germany · 14 July 2021',
  'fact1.mark': '22:14',
  'fact1.text':
    'Between 22:14 and 22:43 a police helicopter films the Ahr valley from Mayschoß to Schuld:<sup><a href="#q1" id="r1">1</a></sup> houses flooded up to the attic, and people signalling with lamps from roofs or windows. According to the police, the videos were “not properly filed”. Until September 2022 the parliamentary inquiry and the public prosecutors assumed that no footage of the flood night existed.<sup><a href="#q2" id="r2">2</a></sup> <span class="tr">Quotation translated from German.</span>',
  'fact2.where': 'Los Angeles · January 2025',
  'fact2.mark': '“unconnected platforms”',
  'fact2.text':
    'The county’s after-action report on the Eaton and Palisades fires states: “First responders and incident commanders were unable to consistently share real-time information due to unreliable cellular connectivity, inconsistent field reporting methods, and the use of various unconnected platforms.”<sup><a href="#q3" id="r3">3</a></sup>',
  'fact3.where': 'Germany · July 2026',
  'fact3.mark': '“tested and consolidated”',
  'fact3.text':
    'The federal government is developing, together with the states, a joint digital operating picture for civil protection, “so that everyone responsible has a uniform basis of information for their operations, digitally and in real time”.<sup><a href="#q4" id="r4">4</a></sup> On its status the government stated in July 2026: “The procedure is currently being tested and consolidated.”<sup><a href="#q5" id="r5">5</a></sup> <span class="tr">Quotations translated from German.</span>',
  'purpose.label': 'The measurable purpose',
  'purpose.claim': 'Time from recording to awareness.',
  'purpose.t0': 'first image of the event',
  'purpose.gap': 'detection delay',
  'purpose.t1': 'alert on the map',
  'purpose.text':
    'Sicht measures exactly this distance: the seconds between the first image of an event and the alert on the map – in every exercise, per event, verifiable.',
  'kpi1.k': 'Detection delay',
  'kpi1.v': 'Seconds from an event appearing in the image to the alert; measured per event in every exercise.',
  'kpi2.k': 'Coverage',
  'kpi2.v': 'Share of the recordings received that have been analysed in full.',
  'kpi3.k': 'Recorded queries',
  'kpi3.v':
    'Number of queries and of refused queries. An answer is delivered only after the ledger entry has been written; by construction there are no queries without an entry.',
  'sources.label': 'Sources',
  'sources.back': 'Back to the text',
  src1: 'dpa, in: Volksstimme, 5 October 2022 (in German).',
  src2: 'epd, in: evangelisch.de, 4 October 2022 (in German).',
  src3: 'County of Los Angeles: McChrystal After-Action Report. Alerts, Warnings and Evacuations – Highlights of Findings and Recommendations, September 2025.',
  src4: 'Federal Ministry of the Interior: Eckpunkte Pakt für den Bevölkerungsschutz (key points of the civil protection pact), 20 May 2026, p.&nbsp;5 (in German).',
  'src4.link': 'copy hosted by augengeradeaus.net',
  src5: 'German Bundestag, printed paper 21/7126 of 9 July 2026, federal government’s answer to question 28, p.&nbsp;10 (in German).',

  // ---------------------------------------------------------------- 02 product
  'produkt.h2': 'Knowing what your own footage shows.',
  'produkt.intro':
    'Sicht does not replace a command and control system. It supplies what is missing today – in seven parts that rest on the same principle.',
  'produkt.hint': 'Screenshots of the console, German interface · exercise material · each opens enlarged',
  'mod1.gloss': 'overview',
  'mod1.tab': 'LAGE tab · situation map',
  'mod1.text':
    'The situation map shows sources, alerts and incidents where they were recorded, with an MGRS grid and the grid reference under the pointer. It is drawn in-house from OpenStreetMap vector data and contour lines and needs no tile service. Alerts of the same kind at the same place become one incident.',
  'mod1.alt': 'Console, LAGE tab: situation map with eleven sources, running alerts, incidents and the frames of the sources',
  'mod1.cap':
    '<b>Console · LAGE</b> Exercise RHEIN-MOSEL at T+07:10: eleven sources on the map, six of 13 alerts still running, ten incidents.',
  'mod1.dalt': 'Console: an alert of the watch “Brand” (fire) with frame, source, grid reference and the buttons to confirm or dismiss it',
  'mod1.dcap':
    '<b>Detail</b> A single alert: the watch “Brand” (fire) at Erkunder 3, with grid reference and confidence. Whether it is confirmed or dismissed is decided by a person.',
  'mod2.gloss': 'insight',
  'mod2.tab': 'SUCHE tab · search',
  'mod2.text':
    'A description in plain words, in German or English, searches all incoming footage and returns one frame per scene with the matching region marked. Every search requires a mandate. Queries for names, faces, licence plates, or for protected and bodily features of persons are refused, and the refusal is recorded in the ledger.',
  'mod2.alt':
    'Console, SUCHE tab: six hits for the query “überflutete Wiese” (flooded meadow), a map of where they were found, and the answer of a peer node',
  'mod2.cap':
    '<b>Console · SUCHE</b> Query “überflutete Wiese” (flooded meadow): six hits in 33 scenes searched, three sources on the map; at the lower right the answer of the peer node Trier with its receipt.',
  'mod2.dalt': 'Console: a single hit; the frame is darkened except for the place that matched',
  'mod2.dcap': '<b>Detail</b> A single hit: whatever the query does not respond to is darkened.',
  'mod3.gloss': 'caution',
  'mod3.tab': 'WACHEN tab · watches',
  'mod3.text':
    'A watch is a standing query in words: it checks new footage on its own and raises an alert once a description holds across several frames. Analysts’ verdicts take effect only when someone explicitly retrains the watch; every version is numbered.',
  'mod3.alt': 'Console, WACHEN tab: nine watches; selected is “Umgestürzter Lastkraftwagen” (overturned lorry) in version 2',
  'mod3.cap':
    '<b>Console · WACHEN</b> The watch “Umgestürzter Lastkraftwagen” (overturned lorry) in version 2, retrained from one confirmed and one dismissed verdict.',
  'mod3.dalt': 'Console: form for a new watch with a preview of the frames that would have raised an alert',
  'mod3.dcap':
    '<b>Detail</b> A new watch, checked against the stock before it is set: 57 of 567 frames would have raised an alert.',
  'mod4.gloss': 'review',
  'mod4.tab': 'VORGÄNGE tab · cases',
  'mod4.text':
    'Frames are secured in a case with the SHA-256 checksum of the unmasked original and are exempt from the deletion period for as long as the case exists. A sealed case cannot be changed and can be issued as a printable report whose seal is recorded in the ledger.',
  'mod4.alt': 'Console, VORGÄNGE tab: a sealed case with one secured frame, its checksum and the seal',
  'mod4.cap': '<b>Console · VORGÄNGE</b> A sealed case with one exhibit, its checksum and the seal.',
  'mod5.gloss': 'far sight',
  'mod5.tab': 'VERBUND tab · federation',
  'mod5.text':
    'Nodes of different authorities answer each other’s queries without handing over recordings: what travels is the signed question, with its mandate and the person asking. What comes back are at most twelve masked previews and the number of the ledger entry under which the answering node recorded the request.',
  'mod5.alt': 'Console, VERBUND tab: map with the nodes Koblenz, Trier and Mainz and the list of peer nodes',
  'mod5.cap': '<b>Console · VERBUND</b> Three nodes: Koblenz with its peers Trier and Mainz, both reachable.',
  'mod6.gloss': 'oversight',
  'mod6.tab': 'PROTOKOLL tab · ledger',
  'mod6.text':
    'Every sign-in, search, refusal, approval and export is written to a ledger whose entries are chained with SHA-256. Oversight verifies the chain in one step, draws random samples of the queries and exports the ledger in full.',
  'mod6.alt': 'Console, PROTOKOLL tab: chain verified and intact, below it the chained entries',
  'mod6.cap':
    '<b>Console · PROTOKOLL</b> Chain verified and intact; below it refusals, a seal and the retraining of a watch.',
  'mod6.dalt': 'Console: a sample drawn from the recorded queries',
  'mod6.dcap': '<b>Detail</b> Oversight’s sample: four queries drawn, three of them refusals.',
  'mod7.gloss': 'consideration',
  'mod7.tab': 'Throughout, in every tab',
  'mod7.text':
    'Faces are made unrecognisable at ingest; the unmasked frame is available only with a stated reason and the approval of a second person, limited to 15 minutes. Without a mandate stating purpose and legal basis, no analysis is possible. The three pictures show the same procedure in the console.',
  'mod7.alt1': 'Detail of the console: a person at a collapsed road, the face pixelated',
  'mod7.cap1': '<b>1</b> Masked at ingest',
  'mod7.alt2': 'Detail of the console: dialog for lifting the masking, with the reason and the approving person',
  'mod7.cap2': '<b>2</b> Reason, approval by a second person',
  'mod7.alt3': 'Detail of the console: the same frame unmasked, marked as original with the approval active',
  'mod7.cap3': '<b>3</b> Original, limited to 15 minutes',

  // ---------------------------------------------------------------- 03 method
  'flow.h2': 'From image to alert.',
  'flow.intro': 'Eight steps, one ledger. Every step runs on the authority’s own machine.',
  'flow1.k': 'Source',
  'flow1.v': 'drone, helicopter, gauge camera, vehicle',
  'flow2.k': 'Masking',
  'flow2.v': 'faces made unrecognisable, original kept under lock',
  'flow3.k': 'Embedding',
  'flow3.v': 'frame and regions as vectors with 768 dimensions (SigLIP 2)',
  'flow4.k': 'Index',
  'flow4.v': 'vectors per recording, on the local machine',
  'flow5.k': 'Search · Watches',
  'flow5.v': 'free description, in German or English, or standing query',
  'flow6.k': 'Alert',
  'flow6.v': 'a match across several frames',
  'flow7.k': 'Incident',
  'flow7.v': 'alerts at one place, from several sources',
  'flow8.k': 'Case',
  'flow8.v': 'secured frames with checksum',
  'flow9.k': 'Ledger',
  'flow9.v': 'Every step with person, mandate and time – chained with SHA-256, verifiable in one pass.',

  // ---------------------------------------------------------------- 04 federation
  'fed.h2': 'Only the question travels.',
  'fed.intro':
    'An incident does not stop at the county line. Whoever needs footage held by another authority has it sent over today, or pools it in one place. In the federation it stays where it was recorded.',
  'fed.s1': 'The question goes out signed – with mandate, legal basis and the person asking.',
  'fed.s2': 'Each node checks it against its own rules and may refuse.',
  'fed.s3': 'What comes back are masked previews and a receipt number: the ledger entry of the answering node.',
  'fed.s4': 'Nodes witness the state of each other’s ledgers. A later change would show at the neighbour.',
  'fed.title':
    'Diagram: node A sends a signed question to nodes B and C. Masked previews and one receipt number each come back. The recordings stay inside every node.',
  'fed.a': 'NODE A',
  'fed.a2': 'asking authority',
  'fed.b': 'NODE B',
  'fed.b2': 'checks by its own rules',
  'fed.c': 'NODE C',
  'fed.stays': 'footage stays',
  'fed.receipts': '2 receipts in the ledger',
  'fed.out': 'QUESTION · SIGNED →',
  'fed.back': '← PREVIEW · MASKED',
  'fed.back2': '← RECEIPT NUMBER',
  'fed.out.n': '↓ QUESTION · SIGNED',
  'fed.back.n': '↑ PREVIEW · RECEIPT',
  'fed.caption': 'Diagram · federated query between three nodes',

  // ---------------------------------------------------------------- 05 limits
  'limits.h2': 'What Sicht cannot do –<br>and is not meant to.',
  'limits.intro':
    'Some of these limits are architecture: there is no face recognition model, no licence plate reader and no central data pool. The others are rules that the system enforces and records. What cannot be overseen, Sicht does not build.',
  'limit1.k': 'No face recognition, no matching against images of persons.',
  'limit1.v': 'There is no model for it in the system; the face detector serves masking only. Faces are masked in every frame.',
  'limit2.k': 'No licence plates: they are neither read nor searched.',
  'limit2.v': 'There is no plate reader and no matching against registers. Queries that name a licence plate are refused.',
  'limit3.k': 'No finding again and no tracking of particular persons.',
  'limit3.v':
    'Such queries are refused. Descriptions by sex, age group or clothing are possible only under a mandate that explicitly permits them, for instance a search for a missing person, and are flagged in the ledger. That is a rule with a ledger, not a technical impossibility.',
  'limit4.k': 'No search by origin, religion, health or other protected attributes.',
  'limit4.v':
    'Nor by hair colour, tattoos or other bodily features. The system refuses such queries; the refusal is recorded in the ledger with the rule that fired.',
  'limit5.k': 'No central data pool: footage stays with the authority that recorded it.',
  'limit5.v': 'In the federation the question travels, not the footage.',
  'limit6.k': 'No silent learning in operation: retraining is a separate, recorded step.',
  'limit6.v': 'Every version of a watch is numbered and can be reset.',
  'refusal.label': 'What a limit looks like in the console',
  'refusal.q1': 'water on the road',
  'refusal.ok': 'Permitted.',
  'refusal.a1': 'The search runs under the selected mandate and is recorded in the ledger.',
  'refusal.q2': 'face of mr müller',
  'refusal.no': 'Refused.',
  'refusal.a2':
    'The request aims at recognising, finding again or tracking a particular person. This system describes situations; it identifies no one.',
  'refusal.q3': 'person in a red jacket',
  'refusal.dep': 'Depends on the mandate.',
  'refusal.a3':
    'If the mandate permits descriptions of persons, the search runs and is flagged in the ledger. Otherwise: “This mandate does not permit describing persons by sex, age group or clothing ("jacket"). Please use a neutral wording such as "person".”',
  'refusal.alt':
    'Console, SUCHE tab: the query “Kennzeichen KO AB 123” (a licence plate) is refused; the message names the rule “Kennzeichen”',
  'refusal.cap':
    '<b>Console · SUCHE</b> The query “Kennzeichen KO AB 123” (a licence plate) is refused: “The request concerns a licence plate. This system neither reads nor searches licence plates; they would lead to the keeper.” The refusal is recorded in the ledger.',
  'refusal.note':
    'The refusals are the wording of the console. Benchmarks for these limits: <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" rel="noopener noreferrer" target="_blank">Regulation (EU) 2024/1689, Art.&nbsp;5</a> · <a href="https://www.bundesverfassungsgericht.de/e/rs20230216_1bvr154719.html" rel="noopener noreferrer" target="_blank">German Federal Constitutional Court, judgment of 16 February 2023 – 1 BvR 1547/19, 1 BvR 2634/20</a>.',

  // ---------------------------------------------------------------- 06 measured
  'measured.h2': 'Measured, not promised.',
  'measured.intro':
    'Nine figures from the trial build, measured on 18 November 2026 on four processor cores without a graphics card. What is not listed here has not been measured.',
  'm.h1': 'Figure',
  'm.h2': 'Statement',
  'm.h3': 'Basis',
  'm1.fig': '13 / 13',
  'm1.k': 'Events of the exercise detected',
  'm1.v':
    'Exercise RHEIN-MOSEL: a script with 13 events, eleven sources, 31 recordings, clock in real time. An event counts as detected when the watch intended for it raises an alert at the source concerned.',
  'm2.fig': '1.1&nbsp;s',
  'm2.k': 'Median detection delay',
  'm2.v':
    'Counted from the arrival of the analysed frame; one frame per second, two hits before an alert. Range 1.0 to 1.2&nbsp;s. The computing time of the analysis, about 0.3&nbsp;s per frame, is not included.',
  'm3.fig': '1 / 15',
  'm3.k': 'False alerts',
  'm3.v':
    'A collapsed road was reported as an overturned lorry. After the alert was dismissed and the watch explicitly retrained, none in the following run.',
  'm4.fig': '3.3&nbsp;×',
  'm4.k': 'Analysis relative to real time',
  'm4.v': '577&nbsp;s of footage in 176&nbsp;s, at one frame per second, four regions per frame and with face masking.',
  'm5.fig': '8&nbsp;s',
  'm5.k': 'until 44 recordings are searchable',
  'm5.v': 'From the start of the upload, on the same machine (7.6&nbsp;s measured); analysed in full after 169&nbsp;s.',
  'm6.fig': '29&nbsp;s',
  'm6.k': 'Live stream: first alert after connecting',
  'm6.v':
    'Against a simulated camera that sends a recording of a building fire in a loop (MPEG-TS over TCP), with segments of 10&nbsp;s. With the default of 20&nbsp;s the delay is half to three quarters of a minute. Not tested: real cameras, several streams at once.',
  'm9.fig': '54&nbsp;/&nbsp;66',
  'm9.k': 'Search queries answered on general footage',
  'm9.v':
    '44 recordings of everyday life and traffic, 91 labelled queries in German and English. The first result fits for 64 of 66; of 25 queries for things that are not there, 2 return a match. Words for places and moods such as "kitchen" or "rain" mostly stay below the cut-off. The cut-offs were set on these queries.',
  'm7.fig': '0.1&nbsp;s',
  'm7.k': 'Time for a new search query, median',
  'm7.v':
    'Almost all of it is encoding the text; comparing against 2,108 vectors takes 5&nbsp;ms of it. A federated question to two peers on the same machine: 20 to 400&nbsp;ms.',
  'm8.fig': '99.1&nbsp;%',
  'm8.k': 'Hazard model on its benchmark',
  'm8.v':
    'Macro F1 0.991 on the AIDERv2 test set of 1,654 aerial images; without training 85.1&nbsp;%. On the exercise footage the model errs and therefore raises no alerts.',
  'measured.caveat':
    '<b>Two caveats.</b> The watches of the exercise were worded on the exercise footage; the figures show how the system behaves in operation, not its quality on unseen operational footage. And the hazard model errs on the exercise footage despite its benchmark figure: it takes a calm river for a flood. It therefore raises no alerts, but stands as a second opinion next to alerts from aerial sources.',
  'measured.encoder':
    'Image encoder in all measurements: SigLIP 2 (Google, Apache-2.0), 34&nbsp;ms per frame on this machine. It runs offline and understands queries in German and English.',
  'measured.alt': 'Console, WIRKUNG tab: detection delay, coverage, recorded queries and the events of the exercise with their delay',
  'measured.cap':
    '<b>Console · WIRKUNG</b> A different run from the one in the table: the same script with the exercise clock at eight times speed. Its figures differ – delay 2.3&nbsp;s instead of 1.1&nbsp;s, 16 alerts instead of 15, analysis at 3.7 instead of 3.3 times real time; the search time comes from a single federated question. The table follows the measurement report.',

  // ---------------------------------------------------------------- 07 operation
  'ops.h2': 'Runs at the authority.<br>Stays at the authority.',
  'ops1.k': 'Own hardware',
  'ops1.v':
    'Sicht runs on a machine owned by the authority. A processor is enough to analyse recordings; by calculation, a machine with four cores analyses about three streams at once. More simultaneous sources need more computing power or a graphics card. At start-up the node compares the results of a graphics card with those of the processor; if they differ, it continues on the processor.',
  'ops2.k': 'Offline',
  'ops2.v':
    'After a one-time download of the models (about 950&nbsp;MB) the node works without an internet connection. Map, typeface and interface are stored locally. Connections exist only where the operator sets them up: to peer nodes in the federation and to connected live streams.',
  'ops3.k': 'Freely licensed image model',
  'ops3.v':
    'The image encoder is SigLIP 2 by Google under the Apache 2.0 licence. It understands queries in German and English and can be exchanged. There is no remote service that could be switched off.',
  'ops4.k': 'No cloud',
  'ops4.v': 'Recordings and index never leave the node. Within the federation only the question goes out; masked previews come back.',
  'ops9.k': 'Live streams, with a delay',
  'ops9.v':
    'A source can carry a stream address (RTSP, HLS, RTMP, SRT, MPEG-TS). The stream is cut into segments of 20 seconds and each segment is analysed like a recording; alerts follow about half a minute after the event. Only supervisors may connect a stream. This has been tested against a simulated camera, not against devices in the field.',
  'ops5.k': 'Interfaces',
  'ops5.v':
    'Incidents as GeoJSON and as CAP 1.2 messages, reports as printable documents. Sicht is meant to feed existing situation-picture and warning systems, not to replace them; a tested coupling does not exist yet.',
  'ops6.k': 'Roles',
  'ops6.v': 'Analysts, supervisors and oversight hold separate rights. Oversight sees the ledger, but no footage.',
  'ops7.k': 'Deletion period',
  'ops7.v': 'Recordings are deleted after a configurable period, 60 days by default. Exempt is whatever has been secured as evidence in a case.',

  // ---------------------------------------------------------------- 08 status
  'status.h2': 'Trial build.',
  'status.intro':
    'Sicht is software at trial stage. Everything this page shows runs on exercise material. There are no government customers, no certification and no operational use. The name has not been checked against trademark registers.',
  'open.label': 'Limits of this build',
  'open1.k': 'Live streams only with a delay, and tested only in the lab',
  'open1.v':
    'A connected stream is cut into segments of 20 seconds and analysed like a recording; alerts follow about half a minute after the event. This has been tested against a simulated camera, not against devices in the field. By calculation, a machine with four cores analyses about three streams at once; the exercise with eleven sources therefore replays footage analysed in advance.',
  'open2.k': 'No connection to a command and control system',
  'open2.v': 'There are outputs as GeoJSON and CAP 1.2, but no tested coupling to an existing system.',
  'open3.k': 'Sign-in built for the demonstration',
  'open3.v':
    'Three fixed accounts for analysis, supervision and oversight with one shared password. No connection to a directory service, no two-factor sign-in.',
  'open4.k': 'Rules, not impossibilities',
  'open4.v':
    'The query check is a traceable check of words. It can be circumvented by paraphrase; that is what the ledger and the sample are for. Descriptions by sex, age or clothing are possible under a mandate that permits them.',
  'open5.k': 'No legal opinion',
  'open5.v':
    'Whether an authority may analyse footage in this way is decided by its legal basis. The documentation of Sicht maps the requirements to the safeguards that have been built and names what is missing.',
  'open6.k': 'Scale',
  'open6.v': 'The search compares every query with every vector. It is designed for a few million vectors per node, not for more.',
  'demo.label': 'A demonstration in 15 minutes',
  'demo.intro':
    'Everything shown runs on a single laptop, without a network connection. Three nodes – Koblenz, Trier and Mainz – talk to each other only through the federation protocol, as nodes on three machines would. The exercise replays recordings analysed in advance on a clock.',
  'demo1.k': 'Mandate',
  'demo1.v': 'Sign in and select the mandate of the exercise. Without purpose and legal basis, no analysis.',
  'demo2.k': 'Situation',
  'demo2.v': 'Start the exercise: eleven sources on the map. Seconds after the first frame of a flood, the alert stands at its place.',
  'demo3.k': 'Review',
  'demo3.v': 'Open an alert, see what the watch responds to, and confirm it. Alerts of the same kind at the same place become one incident.',
  'demo4.k': 'Retrain',
  'demo4.v': 'A false alert is shown, not hidden: dismiss it, explicitly retrain the watch, version 2.',
  'demo5.k': 'Federation',
  'demo5.v':
    '“überflutete Wiese” (flooded meadow), asked across the federation: hits from the node’s own stock, and from the peers masked previews with a receipt.',
  'demo6.k': 'Refusal',
  'demo6.v': '“Gesicht von Herrn Müller” (face of Mr Müller), “Kennzeichen KO AB 123” (a licence plate): refused, with the rule, in the ledger.',
  'demo7.k': 'Case',
  'demo7.v': 'Secure a frame with the checksum of the original, seal the case, issue the report.',
  'demo8.k': 'Oversight',
  'demo8.v': 'Verify the ledger chain, draw a sample, read the measurements of the exercise.',
  'trial.label': 'A trial in three steps',
  'trial1.k': 'Set up',
  'trial1.v': 'A node is installed on a machine at the authority, without any connection to existing systems.',
  'trial2.k': 'Exercise',
  'trial2.v': 'The authority’s own footage from a past exercise or a closed operation is loaded. The analysts word the watches themselves.',
  'trial3.k': 'Measure',
  'trial3.v':
    'The detection delay is reported per event, along with coverage, false alerts and recorded queries. The authority decides on the basis of its own figures.',
  'trial.note': 'A trial with real footage is preceded by a data protection impact assessment. Sicht supplies the technical description for it.',

  // ---------------------------------------------------------------- footer
  'foot.motto': 'No sight without oversight.',
  'foot.k0': 'Word',
  'foot.v0': 'Sicht (German, f.) – sight; a clear view of a situation.',
  'foot.k1': 'Status',
  'foot.v1': 'Trial build · exercise material · no operational data',
  'foot.k2': 'Map',
  'foot.k3': 'Typeface',
  'foot.v3': 'JetBrains Mono, bundled locally · <a href="assets/fonts/OFL.txt">SIL Open Font License 1.1</a>',
  'foot.k4': 'Image model',
  'foot.v4': 'SigLIP 2 (Google) · Apache 2.0 · runs offline',
  'foot.k5': 'Footage',
  'foot.v5':
    'The screenshots show freely licensed stock footage (Mixkit) from an exercise, not the places named. The film shows AI-generated symbolic images.',

  // ---------------------------------------------------------------- larger view
  'zoom.prev': 'Previous picture',
  'zoom.next': 'Next picture',
  'zoom.close': 'Close',
};

/* Labels drawn on the hero map. Generic exercise wording; positions are set in main.js. */
window.SICHT_MAP_TEXT = {
  de: {
    alert: 'MELDUNG',
    targets: ['WASSER AUF FAHRBAHN', 'TREIBGUT AN BRÜCKE', 'PERSONEN AUF DACH', 'RAUCH ÜBER GEBÄUDE'],
    sources: ['DROHNE 2', 'PEGELKAMERA', 'HUBSCHRAUBER', 'DROHNE 1'],
    rivers: { Rhein: 'RHEIN', Mosel: 'MOSEL', Lahn: 'LAHN' },
  },
  en: {
    alert: 'ALERT',
    targets: ['WATER ON ROADWAY', 'DEBRIS AT BRIDGE', 'PEOPLE ON ROOF', 'SMOKE OVER BUILDING'],
    sources: ['DRONE 2', 'GAUGE CAMERA', 'HELICOPTER', 'DRONE 1'],
    rivers: { Rhein: 'RHINE', Mosel: 'MOSELLE', Lahn: 'LAHN' },
  },
};
