# Hard questions, short answers

English edition of the German paper `docs/FAQ.md`, as of 18 November 2026. It is a translation of
a selection of its answers; where the two differ, the German text counts. Sicht is software at
trial stage: there are no customers, no certification and no live operation, and the name has not
been cleared as a trade mark. All prices are assumptions.

## From a ministry

### Isn't this a small Palantir?

No, and the comparison helps nobody. For the police, Palantir brings together data holdings
about people. Sicht brings nothing together and knows no persons: it searches an authority's
pictures for situations and leaves them where they were taken. When one authority asks another,
only the question travels; masked previews with a receipt number come back. It is also true that
Palantir was tested as a situation picture in the Hessian coronavirus crisis unit in 2020 and
offers purpose-bound queries, logs and a comparison between instances. A free-text search over
video is not documented as a Palantir product. Sicht does not set out to replace anything; it is
the image layer for situation systems that authorities already have.

### The federal and state governments are building a digital situation picture. Why Sicht?

The digital situation picture brings reports together; a pilot application was built in 2026,
and the decision on joint operation is due in 2027
([Bundestag printed paper 21/7120, answer 56](https://dserver.bundestag.de/btd/21/071/2107120.pdf),
in German). What can be seen in the pictures from drones, helicopters and cameras still has to
be looked at by a person and reported by hand. Sicht delivers that part as a report with place
and time. Whether the federal situation picture provides for such a feed, we do not know; the
maker and the technology of the pilot application have not been published.

### What does it cost?

All prices are assumptions and not an offer. A three-month trial costs a fixed 25,000 €, the
licence for a district's node 48,000 € a year, a state node 120,000 € and a state's federation
licence 180,000 € a year, the introduction 15,000 € once per node. Added to that are the machine,
which the authority provides, and its own effort for the data-protection review and training.
There are no operating costs at the vendor, because nothing runs there.

### What is finished today, and what is not?

Finished and walked through in the browser in all three roles: ingesting and analysing video
files, free-text search in German and English, watches with alerts, incidents and explicit
retraining, face masking with release by a second person, mandates, three roles, the chained
ledger with verification and sampling, cases with checksums and a seal, the federation between
three nodes on one machine, the deletion period, the situation map with a UTM grid, and output as
GeoJSON and CAP. Measured is an exercise of our own with archive footage: 13 of 13 events
reported, a delay of 1.1 seconds at the median, one false alert among 15 alerts. Built but tested
only in the lab are live streams: a camera stream can be connected and is analysed with a delay
of about half a minute; this has been tested against a simulated camera, not in the field. Not
finished: a trial with real cameras, a tested coupling to ELD-BS or CommandX, user
management and sign-in beyond three demonstration accounts, encryption of the disk, management
of certificates, and a deletion concept for the ledger. Nothing that concerns real operational
footage has been measured. Since 18 November 2026 the image encoder is SigLIP 2 under Apache 2.0.

### On what legal basis may we use it?

You clarify that with your data-protection authority, and the answer is not certain.
Rhineland-Palatinate regulates in § 60 LBKG when drones may record and that recordings must be
deleted after two months at the latest; the provision says nothing about automated analysis.
North Rhine-Westphalia refers to § 46 BHKG. On police laws, the Federal Commissioner for Data
Protection has stated that the mass analysis of video files by AI is not a simple comparison. We
recommend starting in an exercise on closed-off ground, and a legal opinion per state.

## From data protection

### Is this surveillance?

Sicht analyses pictures in which people may be seen. That is an interference, and the system is
built accordingly. It does not observe persons; it looks for situations: water on a road, smoke,
a collapsed wall, people on a roof. It matches no faces and reads no licence plates, keeps no
personal records and links no data holdings. Every analysis needs a mandate with a purpose and a
legal basis, and is recorded in a ledger that is checked by an oversight role which itself sees
no pictures. Whether that is enough is not for the maker to decide.

### Can it be used to search for people after all?

Yes, within limits, and that is intended: “person on a roof” and “person in the water” are rescue
situations. Refused are queries for names, faces and licence plates, for origin, religion and
other protected characteristics, for physical features such as hair colour or tattoos, and
queries to find a particular person again or to follow them. Descriptions by sex, age or clothing
are possible only under a mandate that expressly permits them, for instance in a search for a
missing person; such searches are marked in the ledger. Under such a mandate a person in a
conspicuous jacket could be found again across several sources. No technical barrier prevents
that; the rule, the ledger and the oversight sample do. The screening works with word lists and
can be circumvented with paraphrases; limiting the search space per mandate is still to come.

### Is face masking enough to anonymise?

No. Without a face, clothing, build, vehicles and buildings can still be attributed to a person;
that is, for example, the view of the Thuringian state commissioner for data protection.
Masking reduces what users get to see. The original stays stored and can be retrieved only with a
reasoned release by a second person, for 15 minutes. How many faces the detector misses has not
been measured.

### Who checks what is queried?

Every search, every refused query, every release and every export is in the ledger with person,
mandate and time. The entries are chained by checksums; whoever changes or removes one breaks the
chain at that point. The oversight role verifies the chain and draws random samples but sees no
pictures. In the federation the partners record each other's ledger state, so that nobody can
rewrite their ledger unnoticed. The chain can be recalculated without Sicht: the export comes
with two short verifiers, one in Node and one in Python, which an oversight body can read itself
and run on a machine of its own. Two gaps: retrieving single pictures is not recorded, and
whoever has access to the machine can delete the ledger file.

### What leaves our premises in the federation?

When you ask: your question, your mandate and the name of the person asking. When you are asked:
at most twelve reduced, masked previews with place and time and the number of your ledger entry
as a receipt, and only from sources you have released one by one. Recordings and index stay with
you; your node screens the foreign question by your own rules and records it. A preview is
personal data too, so its transmission needs a legal basis. The connection between nodes is
signed; it is encrypted when both sides have a certificate in place, which so far has been tested
only in the lab.

### Does the system learn from our data?

Not by itself. The model weights do not change in operation. When your staff confirm or dismiss
alerts, that is collected; a watch changes only when someone retrains it explicitly. That creates
a new version, is recorded in the ledger and can be undone. In our own exercise one dismissed and
one confirmed verdict were enough for a false alert to stay away after retraining. Your pictures
do not leave the node in the process.

## From IT and procurement

### Has anyone reviewed the software for security?

The source code, yes; nobody from outside has yet attacked a running system. A second reviewer
read the whole node and documented 21 findings, five of them severe: pictures were briefly
retrievable during analysis before they were masked; the query screening could be bypassed with
special characters; two query paths wrote no ledger entry. These five and most of the others are
fixed and backed by tests or a recorded run. Still open are, among other things, the unencrypted
disk, the management of certificates and limits against overload. A penetration test by an
accredited body is still to come and belongs before any operation with real data.

### What is the software made of, and under which licences?

Of 143 packages, three models, one typeface and map data; every part is listed with version,
checksum and licence in a bill of materials (CycloneDX). No package is under GPL or AGPL; the
image library libvips is under the LGPL and is loaded as a file of its own. The comparison with
known vulnerabilities of 18 November 2026 names no finding in the shipped packages. That is a
snapshot, not a legal review of the licences.

### Is the software accessible?

Checked, not certified. An automatic check against the rules of WCAG 2.1 at levels A and AA finds
no violated rule in 15 states of the console and on the website; before, there were six, mostly
secondary text with too little contrast. Signing in, starting the exercise, choosing an incident,
searching and opening a picture work without a mouse, and new alerts are announced to screen
readers. Not checked: use with a screen reader, magnification to 200 per cent, the documents. The
markers on the map can only be selected with the mouse; what they show is listed beside it. A
test under the German accessibility rules (BITV) by a test body is still to come.

### What does the machine need, and how is it backed up?

Four cores, 8 GB of memory (the node takes about 3 GB at start and about 1.7 GB in operation),
about 950 MB for the models, and about 3.3 MB per minute of footage on top of the recording
itself. A backup is made by ending the node and copying its data folder; the copy of a node was
started elsewhere, the ledger was intact and the search worked. An endurance run of 19 minutes
with seven exercise runs stayed flat in memory. Operation over days has not been measured, and
there is no service with automatic restart yet.

## From investors

### Does this exist already?

The parts do; the combination, as far as our research goes, does not. More than ten makers offer
free-text search over video; a state-wide situation picture for civil protection runs in
Baden-Württemberg; the city of Kaohsiung watches its cameras for flooding, fire and road damage
with vision-language models. No vendor we found combines free-text search, the cut for civil
protection and a federation without identification and has that in use with a state. With none
of them did we find the principle that in a federation only the question travels and the picture
stays where it was taken. That is the result of a time-limited search in public sources, not
proof; vendors and sources are listed in `docs/STRATEGY.md`, section 4 (German).

### Why not Fraunhofer?

Fraunhofer IOSB built the situation system of the state of Baden-Württemberg, analyses drone
pictures for emergency services and could add free-text search. As far as is publicly visible,
what is missing there so far is search with free terms instead of fixed classes, and a federation
in which only the question travels. A research institute also rarely delivers a product with a
price list, introduction and maintenance for four hundred districts. That makes IOSB both the
obvious partner and the competitor that could make Sicht superfluous fastest.

### How big is the market?

Small. 400 districts, 16 states and ten federal bodies come to about 25 million € a year at the
assumed list prices with full coverage; reachable in five years are, on the assumptions, just
under 10 million €. In the base case of the financial model, 2031 shows about 2.3 million € in
revenue and a funding need of 3.2 million € up to then. It only gets bigger with operators of
critical infrastructure or abroad; both are unexamined. Adding critical infrastructure and
scaling to the European Union by population gives 470 to 650 million € a year on paper. A
valuation of one billion would need 10 to 21 per cent of that and 35 to 52 times the base case.
That is a calculation with five unproven conditions (`docs/STRATEGY.md`, section 7), not a
forecast.

### What protects you against imitators?

Little technology, some time. Free-text search over video is offered by more than ten makers, and
the models are freely available. What is our own is the combination of the cut for civil
protection, the renunciation of any identification, and a federation without a shared data
holding; a larger vendor can rebuild that too. A lead only comes from the first measured trial,
the first coupling to an existing system and the trust of a data-protection authority. All three
are still to come.
