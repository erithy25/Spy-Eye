# Erda: competitive landscape and white-space test

Research date: 2026-11-18. Method: web search and page fetches only, no vendor contact, no paid databases.
Sources are numbered in [Section 8](#8-sources). A source marked *(excerpt only)* was read through a search-result excerpt, not the full page. "unverified" means I could not confirm the point. Limits of this research are listed in [Section 7](#7-limits-and-open-items).

## 1. Verdict on the white-space claim

1. No vendor found that combines all three flags and is deployed with a national or state government. This is absence of evidence from a time-boxed search, not proof.
2. Each single flag is already taken: free-text video search ships from more than ten vendors, and state-wide civil-protection situation pictures run in Germany.
3. The core idea already runs with a government: Kaohsiung City (Taiwan) uses vision-language models on city cameras for floods and fires and publishes results.
4. "Palantir does not solve this" is only partly true. No open-vocabulary video search and no German civil-protection product is documented, but Palantir was tested as a crisis-staff Lagebild in Hesse and used for hurricane relief.
5. Purpose binding, audit logs and "no facial recognition" are already claimed by others. Query-only federation ("the question travels, the video stays") is the one principle I found at no vendor.
6. Demand for a digital Lagebild is documented (federal pilot 2026, decision 2027). Demand for visual search inside it is not documented anywhere I looked.
7. The window is short: Fraunhofer IOSB, Milestone with BriefCam, and the Esri-based staff software can each close the gap from their side.

### 1.1 Evidence behind the verdict

1. **The claim holds only in its narrow form.** I found no vendor that combines open-vocabulary visual search, a product built for civil protection or crisis staffs, and federated, biometrics-free-by-design operation, and that is deployed with a national or state government. The nearest cases are compared in [Section 4](#4-where-the-white-space-is-and-where-it-is-not).
2. **It fails in its broad form: every ingredient already ships.** Free-text video search is offered by Flock (launched February 2025 [21]), Verkada (May 2024 [33]), Axis (January 2025, processed on the local server [40]) and Genetec (February 2026 [34]); Milestone announced on-premises, air-gapped AI Search through BriefCam for the end of 2026 [36].
3. **The civil operating picture is not empty either.** Baden-Württemberg runs a state-wide digital situation picture built by Fraunhofer IOSB [66][67], Lower Saxony planned state-wide CommandX [80], and Bund and Länder built a first pilot application of a joint digital Lagebild in 2026, with a decision on joint operations due in 2027 [75]. None of these sources mentions AI video search.
4. **Somebody is already doing the core idea with a government.** Kaohsiung City (Taiwan) runs vision-language models over city camera streams for flooding, fire and road incidents with Linker Vision and NVIDIA, and publishes measured results [59][60]. The sources say nothing about privacy design or federation.
5. **"Palantir does not solve this" is only partly true.** No public source shows Palantir offering open-vocabulary video search or a civil-protection product in Germany; its German deployments are police data-analysis platforms [5]. But Hesse's Corona crisis staff tested Palantir Foundry in 2020 as a real-time Lagebild [9], Maven Smart System was used for Hurricane Helene relief [4], and Palantir already ships purpose-justification prompts [10], append-only audit logs [11] and peer-to-peer federation between instances [2].
6. **The defensible white space is the combination, and one element in particular.** "The question travels, the video stays" is the one governance principle I did not find documented at any vendor. Purpose binding, audit and "no facial recognition" are each already claimed by someone [10][11][20].
7. **The window is short.** Fraunhofer IOSB holds both a state Lagebild and video-AI assets [67][68][70], Milestone plans air-gapped search by end of 2026 [36], and the federal Lagebild decision is in 2027 [75].

## 2. Palantir: what it does and what it does not

### 2.1 Products

- **Gotham** links data from different sources and helps investigators find connections between people, places and events [6]. The German police versions merge records from several police databases and show the links as networks [5].
- **"Video" application.** A 2022 Palantir brochure lists it next to the Gaia map and Dossier applications. It describes tagging entities such as buildings, cars or persons of interest, layering geospatial data on live or archived video, and "automated insights from computer vision over full motion video". The brochure addresses defence and intelligence users [2].
- **Foundry** is the data-integration platform. Palantir markets it for emergency preparedness and response, with HHS Protect (COVID-19) as the case study: about 3,000 users from more than 30 agencies and more than 300 data sources, operational five days after project launch [3].
- **AIP** is the LLM layer. In Maven Smart System it appears as Maven Threads, Maven Agent Studio and Maven Logic [1]. Foundry documents semantic search over objects with embeddings and natural-language queries [116] *(excerpt only)*.
- **Maven Smart System (MSS)** is Palantir's platform for the US Maven programme. It fuses drone video, radar, signals intelligence and documents; computer-vision models find and label potential targets in live satellite or drone video. CSIS does not say whether detection uses fixed classes or free text, and does not describe content search over archived video [1].

### 2.2 German deployments

| State | Name | Status | Source |
|---|---|---|---|
| Hesse | hessenDATA | In use since 2017 | [5] |
| North Rhine-Westphalia | DAR | In operation since 2020; project cost 39 million euros including training and hardware. Contract ends 12 October; a new tender is running; the ministry says a digitally sovereign solution should be the long-term aim | [5][8] |
| Bavaria | VeRA | Started 2024 | [5] |
| Baden-Württemberg | Gotham | Five-year contract, about 25 million euros, no exit clause [6]. Not used operationally as of 22 July 2026 [7]. The ministry calls it an interim solution for a limited period [8] | [6][7][8] |

Federal level: as of 31 March 2026 the federal government had made no decision on specific analysis software for the BKA or Federal Police and was pursuing a modular approach under the P20 programme [16]. P20 is said to prioritise open-source and sovereign European solutions [19]. Germany's domestic intelligence service BfV selected ChapsVision's ArgonOS over Palantir according to Politico, with full roll-out depending on intelligence-law reform [17]. France's DGSI is replacing Palantir with ChapsVision [18]. Nordkurier reports that a federal licence based on ChapsVision was approved on 5 May 2026 for use from 1 January 2028 [7]; I could not corroborate this (unverified).

### 2.3 Does Palantir offer open-vocabulary video search?

Not as a documented product, as far as public sources show. What exists:

- Computer-vision detections over full-motion video in the defence products [1][2].
- Building blocks in Foundry: frame extraction from video and a pattern, recommended by Palantir staff in the developer forum, of running a vision-language model over scene frames [12] *(excerpt only)*.

So a Palantir customer could assemble free-text video search. I found no evidence that Palantir sells it packaged, and none in the German deployments. The ZDF explainer on the German systems mentions no video or image analysis [5].

### 2.4 Does Palantir do civil protection or disaster response?

Yes, in several places, so the pitch must not claim otherwise.

- **Hesse, 2020.** The interior ministry commissioned a test demonstration of Foundry for the state's Corona crisis staff, without purchase obligation. The ministry described Foundry as generating "die Darstellung eines umfassenden Lagebildes in Echtzeit". It then judged the software dispensable because infections had fallen [9].
- **Hurricane Helene, 2024.** The US military used MSS for relief: road closures, communications, force movements, supply allocation, with data passed to FEMA. DefenseScoop calls it the first use of Maven for a hurricane [4].
- **HHS Protect** for the COVID-19 response [3].
- **Non-profits.** Direct Relief used Palantir during Hurricane Sandy [14] *(excerpt only)*; Team Rubicon used Gotham to coordinate volunteers [15] *(excerpt only)*.
- **DHS, 2026.** A five-year blanket purchase agreement worth up to 1 billion dollars lets DHS components including FEMA buy Palantir software [13] *(excerpt only)*.

I found no evidence of Palantir in German Bevölkerungsschutz or Katastrophenschutz beyond the 2020 Hesse test.

### 2.5 Governance features Palantir already has

- **Purpose justification.** Foundry "Checkpoints" interrupts sensitive interactions, asks the user for a justification, and stores a record that administrators can review. It is integrated into more than 60 interactions [10].
- **Audit.** Foundry audit logs are described as append-only [11] *(excerpt only)*.
- **Federation.** "Nexus Peering" replicates data across servers in different enclaves so partner nations can share it, including in low-bandwidth conditions [2]. This is federation by replicating data, not by sending only a query.

## 3. Players and the three flags

Flags:
- **OV** = open-vocabulary: free-text queries over visual content, not fixed classes.
- **CP** = built for civil protection or crisis staffs, not police or military.
- **FP** = federated and privacy-by-design with no biometric identification.

Values: yes, no, partly, unverified. "No" also covers "not found in public sources".

### 3.1 Palantir

| Player | What it does, who buys it | OV | CP | FP | Source |
|---|---|---|---|---|---|
| Palantir Gotham (hessenDATA, DAR, VeRA, BW) | Cross-database police data analysis; state police forces | no | no | no | [5](https://www.zdfheute.de/wissen/palantir-software-polizei-risiken-faq-100.html) |
| Palantir Foundry and AIP | Data integration with LLM layer; health and civil agencies (HHS Protect); tested by Hesse's Corona crisis staff in 2020 | partly (buildable, not packaged) | partly | partly (purpose prompts, audit, replication peering; no no-biometrics design) | [9](https://media.frag-den-staat.de/files/docs/c4/53/c1/c453c10631374a55a89c40a1c2df3b68/af723c5965108b4c2685ab3019d1eadc7a8e3483.pdf) |
| Palantir Maven Smart System | Military data fusion and targeting with computer vision on drone and satellite video; US DoD, intelligence community, NATO allies; used once for hurricane relief [4] | unverified | no | no | [1](https://www.csis.org/analysis/what-maven-smart-system-and-what-does-it-do) |

### 3.2 Natural-language video search and AI video analytics

| Player | What it does, who buys it | OV | CP | FP | Source |
|---|---|---|---|---|---|
| Flock Safety FreeForm | Plain-language search over video and licence-plate data, across shared networks of agencies; police, real-time crime centres, enterprise security | yes | no | partly (states no facial recognition; central cloud; reads licence plates) | [20](https://www.flocksafety.com/products/flock-freeform) |
| Flock Aerodome (drone as first responder) | Drone-as-first-responder programme for police; Flock bought Aerodome in 2024. Flock Nova: unverified, no source retrieved | no | no | no | [23](https://www.techspot.com/news/113541-flock-fastest-growing-business-60-mph-police-drones.html) *(excerpt only)* |
| Axon (Fusus, Axon Vision, Axon 911) | Real-time crime centre platform; Axon Vision analyses live feeds and raises alerts for 911 and crime-centre staff. Free-text search not mentioned | no | no | no | [24](https://www.officer.com/command-hq/technology/news/55369403/axon-introduces-three-new-ai-tools-during-opening-of-axon-week-2026) |
| Prepared (Axon) | AI-assisted 911 call handling incl. video streams; emergency communication centres | no | partly | no | [25](https://www.police1.com/police-products/real-time-crime-centers/axon-to-acquire-ai-powered-911-communications-company-prepared) *(excerpt only)* |
| RapidSOS | Delivers device and sensor data, incl. live video, to 911 centres | no | partly | no | [53](https://www.officer.com/command-hq/technology/communications/dispatch-technology/press-release/55260147/rapidsos-transformative-technology-to-save-lives-rapidsos-consolidates-emergency-intelligence-to-enable-911-to-make-the-right-decisions-faster) *(excerpt only)* |
| Twelve Labs | Video-understanding models and API (search, summarise); In-Q-Tel is an investor; hiring for intelligence, defence and federal law-enforcement sales [27]. No named government customer found | yes | no | no | [26](https://techcrunch.com/2024/12/12/twelve-labs-is-building-ai-that-can-analyze-and-search-through-videos/) *(excerpt only)* |
| Conntour | Natural-language search and alerts across camera feeds; can run fully on premises; customer Singapore Central Narcotics Bureau | yes | no | partly (on-premises option; stance on biometrics not stated) | [28](https://techcrunch.com/?p=3106434) |
| Ambient.ai | AI monitoring and semantic search for enterprise security | yes | no | unverified | [30](https://www.securitysystemsnews.com/article/ambient-ai-launches-agentic-monitoring-investigation-tools-ahead-of-gsx-2026) *(excerpt only)* |
| Coram AI | Cloud video security with natural-language search; enterprises and school districts | yes | no | no | [31](https://pulse2.com/coram-ai-raises-35-million-series-b-to-accelerate-ai-native-physical-security-platform/) *(excerpt only)* |
| Lumana | AI video security with text search across connected cameras | yes | no | no | [32](https://www.lumana.ai/blog/august-product-update-text-search-alarm-monitoring-and-more) *(excerpt only)* |
| Verkada | Hybrid-cloud cameras; freeform text search for people and vehicles; also sells facial recognition | yes | no | no | [33](https://verkada.com/blog/ai-powered-search) |
| Genetec | Security Center; natural-language search in the SaaS edition since February 2026; security and law-enforcement organisations. Sells an anonymisation module [35] and a "Federation" feature [118] | yes | no | partly | [34](https://www.officer.com/command-hq/technology/security-surveillance/news/55356897/genetec-inc-genetec-expands-security-center-saas-investigation-capabilities-for-large-scale-security-operations) |
| Milestone Systems (XProtect, BriefCam, Hafnia) | Video-management vendor; AI Search by end of 2026, on-premises and air-gapped via BriefCam; face and plate redaction; BriefCam also offers face recognition [120] | yes (announced) | no | partly | [36](https://www.milestonesys.com/press-releases/ai-built-for-security-operations/) |
| Motorola Solutions (Avigilon, CommandCentral Aware) | Natural-language alert rules on the on-premises Avigilon Unity platform ("alert me if you see smoke and people running"); also sells facial recognition [117] and licence-plate recognition [111] | partly (alerts; search not confirmed) | no | no | [38](https://www.motorolasolutions.com/newsroom/press-releases/motorola-solutions-expands-avigilon-enterprise-security-suite.html) |
| Axis Communications | Free-text search in AXIS Camera Station Pro; video processed only on the local server; query moderation and search log | yes | no | partly (on-premises; not federated) | [40](https://newsroom.axis.com/news/acs-pro-free-text-search) |
| Bosch video systems (IVA Pro Context) | Generative-AI scene reasoning for cameras; details beyond trade press unverified | unverified | no | unverified | [41](https://www.securityinfowatch.com/video-surveillance/video/55318548/bosch-iva-pro-context-the-next-evolution-of-visual-intelligence) *(excerpt only)* |
| Dallmeier | German camera and video-analytics vendor; no free-text search found | no | no | unverified | [42](https://dallmeier.com/products/video-analytics-ai) *(excerpt only)* |
| Hikvision AcuSeek | Text-to-video retrieval in recorders, launched June 2025; no emergency-management deployment found in English sources | yes | no | no | [43](https://www.hikvision.com/ph/newsroom/latest-news/2025/hikvision-launches-groundbreaking-acuseek-nvr-redefining-video-retrieval-with-large-multimodal-ai-models) *(excerpt only)* |
| Hexagon (HxGN OnCall, HxGN Connect) | Dispatch and a common operating picture for multi-agency operations; Arlington County public safety and emergency management | no | partly | unverified | [39](https://hexagon.com/company/newsroom/press-releases/2026/arlington-county-elevates-emergency-response-with-hexagons-ai-enhanced-cloud-based-public-safety-platform) *(excerpt only)* |
| Skydio DFR Command | Drone-as-first-responder platform; police-led programmes; no free-text search found | no | no | no | [54](https://www.skydio.com/blog/drone-as-first-responder-integrations-25M-CFS) *(excerpt only)* |

### 3.3 Defence, geospatial and disaster-data players

| Player | What it does, who buys it | OV | CP | FP | Source |
|---|---|---|---|---|---|
| Synthetaic RAIC | Search for any object in imagery and full-motion video; US Air Force; defence and intelligence are more than half of sales | yes | no | no | [44](https://www.defensedaily.com/ai-image-processing-startup-synthetaic-gets-15-million-in-new-investments/advanced-transformational-technology/) *(excerpt only)* |
| Danti | Natural-language search engine for Earth data; US government users incl. Space Force [119]; lists disaster response as a use case | yes (multi-source search, not video) | no | no | [56](https://techcrunch.com/2024/05/02/dantis-natural-language-search-engine-for-earth-data-soars-with-5m-in-new-funding) *(excerpt only)* |
| Esri ArcGIS (Text SAM) | GIS platform with emergency management as a vertical; Text SAM extracts features from imagery with free-text prompts | yes (analyst tool for imagery) | partly | no | [57](https://doc.arcgis.com/en/pretrained-models/latest/imagery/using-text-sam.htm) *(excerpt only)* |
| Safran.AI (Preligens) | Object detection in satellite imagery for military intelligence; French and US militaries | no | no | no | [45](https://www.defensenews.com/global/europe/2024/06/24/safran-in-talks-to-buy-french-ai-startup-preligens-for-220-million/) *(excerpt only)* |
| Helsing | Defence AI and autonomous weapons (HX-2, SG-1, CA-1 Europa); no civil-protection product found | no | no | no | [46](https://breakingdefense.com/2025/09/germanys-helsing-unveils-ai-enabled-ca-1-europa-ucav-targets-2029-entry-to-service/) *(excerpt only)* |
| Anduril Lattice | Defence command and control; won the XPRIZE autonomous wildfire response track, a competition, not an agency deployment | no | no | no | [47](https://runtimewire.com/article/anduril-xprize-wildfire-autonomous-response-win) *(excerpt only)* |
| Vannevar Labs | Collects and analyses public data for national security (Decrypt); text, not video | no | no | no | [48](https://research.contrary.com/company/vannevar-labs) *(excerpt only)* |
| Dataminr First Alert | Real-time event alerts from public data; public-sector and emergency-management users | no | partly | no | [49](https://www.dataminr.com/resources/blog/how-real-time-intelligence-strengthens-emergency-management-by-closing-the-information-gap/) *(excerpt only)* |
| Pano AI | Mountaintop cameras with AI smoke detection; forestry agencies, government agencies, utilities; 17 US states | no | yes | unverified | [50](https://www.kpbs.org/news/science-technology/2026/05/05/states-across-the-wildfire-prone-western-us-are-using-ai-for-early-detection) *(excerpt only)* |
| ICEYE | Radar satellites and flood analysis; Norway's water and energy directorate chose it for nation-wide flood monitoring | no | yes | no | [51](https://www.iceye.com/newsroom/press-releases/norwegian-water-and-energy-authority-selects-iceye-to-deliver-nationwide-satellite-monitoring) *(excerpt only)* |
| One Concern | Disaster-risk and resilience analytics; no 2025 or 2026 government contract found | no | partly | no | [52](https://www.oneconcern.com/product) *(excerpt only)* |
| Gecko Robotics | Inspection robots and Cantilever software; US Navy contract | no | no | no | [55](https://www.geckorobotics.com/news/navy-idiq) *(excerpt only)* |
| ChapsVision ArgonOS | French data-analysis platform positioned against Palantir; DGSI [18], BfV selection [17]; one of four vendors of the Paris 2024 video-analytics trial [64] | unverified | no | no | [18](https://thenextweb.com/news/frances-intelligence-service-is-dropping-palantir-for-a-homegrown-rival) |

### 3.4 Governments already using AI on civil imagery

| Player | What it does, who buys it | OV | CP | FP | Source |
|---|---|---|---|---|---|
| Linker Vision with NVIDIA (Kaohsiung City, Taiwan) | Vision-language models over city camera streams for flooding, fire, road and traffic incidents, routed to the responsible department [60]; city government | yes (VLM-based; free-text query not explicitly documented) | yes | no (not addressed) | [59](https://www.nvidia.com/en-us/case-studies/linker-vision-ai-smart-city-solutions/) |
| Spectee Pro (Japan) | Detects crises from social media plus road and river cameras; more than 1,000 organisations incl. about 100 local governments | no | yes | unverified | [61](https://digitalx.undp.org/SpecteePro_dx3.html) *(excerpt only)* |
| Wintics, Videtics, Orange Business, ChapsVision (France, Paris 2024) | State-run algorithmic video surveillance limited to eight predefined events; facial recognition banned by law [63] | no | no | partly (no biometrics by law; not federated) | [62](https://lcp.fr/actualites/videosurveillance-algorithmique-lors-des-jo-une-experimentation-pas-a-la-hauteur-selon) |
| FEMA geospatial damage assessment (US) | Machine-learning assessment of post-disaster imagery with trained classifiers | no | yes | no | [65](https://govciomedia.com/how-geospatial-imaging-and-it-inform-femas-disaster-response/) *(excerpt only)* |

### 3.5 Germany, Austria, Switzerland: civil protection and crisis-staff software

| Player | What it does, who buys it | OV | CP | FP | Source |
|---|---|---|---|---|---|
| Fraunhofer IOSB, ELD-BS | Electronic situation dashboard for civil protection, built with the Baden-Württemberg interior ministry; used at all administrative levels of the state. No video or AI function mentioned | no | yes | no | [67](https://iosb.fraunhofer.de/en/projects-and-products/electronic-situation-dashboard-civil-protection.html) |
| Fraunhofer IOSB, ABUL | Video exploitation for unmanned aircraft: stabilisation, mosaics, moving-target indication; Bundeswehr, Swiss Air Force | no | no | no | [68](https://www.iosb.fraunhofer.de/en/projects-and-products/abul.html) |
| Fraunhofer IOSB, IDEAL and IDEBOS | Drone video and audio analysis for emergency services: detect, classify, track people and vehicles, place them on a map. Research projects | no | yes | unverified | [70](https://www.iosb.fraunhofer.de/en/projects-and-products/ideal.html) |
| Fraunhofer IOSB, ivisX | Forensic mass-video analysis for law enforcement, incl. facial recognition; being tested by partner agencies | no | no | no | [69](https://www.iosb.fraunhofer.de/en/projects-and-products/ivisx.html) |
| Fraunhofer IOSB behaviour analysis (Mannheim, Hamburg) | Skeleton-based behaviour detection on public cameras for police; Mannheim since 2018, Hamburg since 1 September 2025 | no | no | partly (stick-figure abstraction; not federated) | [72](https://netzpolitik.org/2025/verhaltensscanner-im-mannheim-hier-wird-die-ueberwachung-getestet-die-so-viele-staedte-wollen/) |
| Eurocommand CommandX | Command-support and staff software for fire services, disaster control and rescue services; Lower Saxony planned state-wide roll-out [80]; built on Esri ArcGIS [82] | no | yes | no | [81](https://www.interschutz.de/en/news/news-articles/digital-leadership-clear-and-consistent-26816) |
| Schleswig-Holstein state-wide staff software (DIKatS) | State-wide uniform software for crisis staffs, first component of a data platform due by 2030. Vendor unverified: a search excerpt names Eurocommand and about 6 million euros, the page itself could not be opened | no | yes | unverified | [79](https://www.schleswig-holstein.de/DE/landesregierung/ministerien-behoerden/IV/_startseite/Artikel2026/III/260729_software_bevoelkerungsschutz) *(excerpt only)* |
| BBK and GeKoB, digital Lagebild Bevölkerungsschutz | Joint federal and state situation picture; pilot application built in 2026; decision on joint operations in 2027. Technology and vendor unverified | unverified | yes | unverified | [75](https://dserver.bundestag.de/btd/21/071/2107120.pdf) |
| North Rhine-Westphalia, Digitaler Zwilling Gefahrenabwehr | 3D map of the whole state for fire and disaster authorities; built with IT.NRW. No drones, video or AI mentioned | no | yes | no | [83](https://www.land.nrw/pressemitteilung/digitaler-zwilling-gefahrenabwehr-3d-karten-unterstuetzen-im-einsatz) |
| Bavaria, EPSKweb and GeoKAT | State IT for situation display, to be developed further [121]; a digital Lagebild is part of the 2025 disaster-control concept | no | yes | unverified | [84](https://www.innenministerium.bayern.de/assets/stmi/sus/katastrophenschutz/kschutz_konzept_a4_web.pdf) *(excerpt only)* |
| Switzerland, ELD NAZ and Lageverbundsystem | National electronic situation display since 2019; successor planned as a federation of applications; 31.7 million francs; tender decision June 2026 | no | yes | partly (federated data exchange; no video AI) | [78](https://www.babs.admin.ch/dam/de/sd-web/lqRuYRE6l00x/2026-03-31-Faktenblatt%20Lageverbundsystem%20(LVS).pdf) |
| DLR RESITEK (2024 to 2026) | Research: AI analysis of satellite, aerial and drone imagery into a shared situation picture; demonstrations in June 2026 (Ahr valley) and October 2026 (Braunschweig, with THW and the city fire brigade). Not operational | unverified | yes | partly (camera-data anonymisation is a stated research topic [87]) | [86](https://www.dlr.de/de/aktuelles/nachrichten/2026/moderne-technologien-unterstuetzen-den-katastrophenschutz) |
| DLR MOSAIK (2026 to 2027) | German-Austrian research on multimodal AI situation pictures; users Bavarian and Austrian Red Cross, Johanniter; companies Eifert Systems and Spatial Services | unverified | yes | unverified | [85](https://www.dlr.de/de/eoc/forschung-transfer/projekte-und-missionen/mosaik-multimodale-daten-und-ki-analysen-fuer-interdisziplinaere-lagebilder-im-katastrophenmanagement) |
| DLR MACS with I.S.A.R. Germany | Drone camera producing live maps with AI detection of people groups and vehicle types; exercise use, 2024 | no | yes | unverified | [88](https://adlershof.de/news/echtzeit-lagebilder-fuer-den-katastrophenschutz) |
| RegioGuard-PRO (Fraunhofer EMI, DFKI) | AI cockpit for municipal crisis staffs with a language-model interface to geodata analyses; demonstrator planned by 2028. No video or drone data | partly (language over geodata, not imagery) | yes | unverified | [89](https://www.techzeitgeist.de/ki-cockpit-kommunen-krisenfall-regioguard/) |
| TEMA (EU Horizon project, 2022 to 2026) | AI mapping and prediction for wildfires and floods from drones, sensors and social media; pilots with regional civil protection | unverified | yes | unverified | [102](https://cordis.europa.eu/project/id/101093003/reporting) *(excerpt only)* |
| Airbus (Agnet, wildfire trial) | Field trial in March 2026 linking aircraft, drones and ground teams for wildfire response with a French fire service. Not a product | no | partly | no | [90](https://www.militaryaerospace.com/communications/news/55367091/airbus-links-aircraft-drones-and-ai-for-networked-wildfire-response) |
| Quantum Systems MOSAIC UXS | Command and control for unmanned systems across air, land and sea; defence customers | no | no | no | [91](https://www.grosswald.org/mosaic-uxs-quantum-systems-nato-ai-c2/) |
| IABG | Geodata services, supports Copernicus emergency mapping; no situation-picture software product found | no | partly | no | [92](https://iabg.de/en/services/geodata-services/katastrophenschutz-krisenmanagement) *(excerpt only)* |
| Hensoldt (ESG not separately sourced) | Defence sensors and software; sovereign defence cloud with Schwarz Digits; no civil-protection product found | no | no | no | [93](https://www.cio.de/article/4136012/hensoldt-und-schwarz-digits-schmieden-souveraene-ruestungscloud.html) *(excerpt only)* |
| secunet | IT security and sovereign cloud for authorities (SINA); no video or situation-picture product on its site | no | no | no | [94](https://www.secunet.com/en/) |
| Rohde & Schwarz | Secure communications and critical-infrastructure security; no video-search product found | no | no | no | [95](https://www.rohde-schwarz.com/ch/_256571.html) *(excerpt only)* |
| DISMA (TÜV Rheinland) | Disaster-management software for crisis and administrative staffs: situation displays, logs, hazard forecasts, emergency plans | no | yes | no | [96](https://www.tuv.com/disma) |
| Fireboard | Incident-command software for fire services with situation map and a module for area-wide emergencies | no | yes | no | [97](https://fireboard.net/wp-content/uploads/2019/12/produktblatt_fireboard_grundsystem.pdf) *(excerpt only)* |
| DIVERA 24/7 | Alerting and availability software for emergency organisations | no | yes | no | [98](https://www.divera247.com/downloads/DIVERA247_Vorstellung_LST.pdf) *(excerpt only)* |
| rescueTrack (Convexis) | Vehicle tracking and resource display for rescue services, police and fire services | no | yes | no | [99](https://companies.whoiswho.eena.org/companies/rescuetrack) *(excerpt only)* |
| VOMATEC | Software and platforms for safety organisations; details unverified | unverified | yes | unverified | [100](https://www.interschutz.de/exhibitor/vomatec-innovations/N1602084) *(excerpt only)* |
| MP-FEUER (MP-BOS) | Administration software for fire brigades and rescue services | no | yes | no | [101](https://www.mpbos.de/) |
| Ruatti (Commander) | Unverified. No source could be retrieved | unverified | unverified | unverified | none retrieved |

## 4. Where the white space is, and where it is not

**Is there a vendor with all three flags, deployed with a national or state government?** I did not find one.

How close the nearest cases come:

| Case | OV | CP | FP | Government level | What is missing |
|---|---|---|---|---|---|
| Kaohsiung City with Linker Vision [59][60] | yes | yes | no | City | Privacy design and federation are not addressed in the sources |
| Flock FreeForm [20][21] | yes | no | partly | US state and local police | Police use; licence plates; central cloud |
| Milestone and BriefCam AI Search [36] | yes (announced) | no | partly | Security and law-enforcement customers | Not a civil-protection product; face recognition in the portfolio |
| Fraunhofer IOSB ELD-BS [66][67] | no | yes | no | German state (Baden-Württemberg) | No visual search |
| Federal digital Lagebild pilot [75] | unverified | yes | unverified | Federal and state | Vendor and functions not public |
| DLR RESITEK [86] | unverified | yes | partly | Research with THW and fire brigade | Not operational |

Five observations that matter for the pitch:

1. **Open vocabulary is a commodity in video security.** More than ten vendors in Section 3.2 ship or have announced it. Three document processing on the customer's own hardware: Conntour, Milestone with BriefCam, and Axis [28][36][40]. Erda cannot differentiate on "search your cameras in plain language".
2. **Published evidence that fixed-class video AI under-delivers for the state.** The French parliamentary evaluation of the Paris 2024 trial found that four of the eight authorised use cases did not work [62]. In Mannheim the police could not say how often the software raised alarms or how many offences it detected [72]. This supports an open-vocabulary pitch, but it also means buyers will ask for measured results.
3. **Measurable purpose exists and has been published by a government.** Kaohsiung reports that AI detected 52 percent of incidents during heavy rain on 22 August, flagged black smoke about 3 minutes before reports reached the fire authorities, and cut pothole notification to about 2 minutes [60]. These are the kind of numbers Erda needs for German authorities.
4. **"No facial recognition" as a policy is not enough.** Flock states that FreeForm does not use facial recognition and blocks searches by race, ethnicity, religion and nationality, yet audit logs reviewed by 404 Media show those terms in logged prompts and single queries spanning up to 274 cameras or 198 networks [21]. A filter plus an audit log is what the market already has. Erda's claim has to be architectural.
5. **United States.** I found no emergency-management agency using open-vocabulary video search. The nearest cases are police use of Flock FreeForm [20][21], the military's use of Maven Smart System for hurricane relief [4], and FEMA's classifier-based damage assessment [65].

### Demand signals in Germany

- The federal interior ministry will invest 10 billion euros in civil protection by 2029 [74]. About 6.4 billion of it goes to BBK and THW [75].
- The Pakt für den Bevölkerungsschutz names a "gemeinsames digitales Lagebild Inland für den Bevölkerungsschutz", digital and in real time, as a federal and state project [74].
- Status in July 2026: a first pilot application was developed in 2026; the decision on joint operations falls in 2027 [75].
- The federal government states, in its case for broadband radio for emergency services, that live drone imagery is needed for wildfire and flood response [75].
- A national crisis staff and a national situation centre are being designed [75].
- The existing joint situation report of the GeKoB appeared every 14 days as of June 2022 and was to become digital [76].
- Digital sovereignty is a stated aim in police IT: NRW describes a digitally sovereign solution as the long-term aim, Lower Saxony rules Palantir out, Rhineland-Palatinate tests only European products [8].

What I did not find: any tender, strategy paper or authority statement asking for AI search over video in civil protection. The demand for the picture is documented. The demand for visual search inside it is Erda's hypothesis.

## 5. Closest competitors

### 5.1 Fraunhofer IOSB

Why closest: it built the civil-protection situation dashboard that Baden-Württemberg uses at all administrative levels [66][67], it owns drone-video analysis for emergency services [70] and for the Bundeswehr [68], and its behaviour-analysis software runs with police in Mannheim and Hamburg [72].

Gaps: its video tools use fixed classes [68][70]; ivisX includes facial recognition [69]; the pieces are separate products and projects. For the Mannheim software IOSB has said it will forgo commercial use for now [72].

How Erda must differ: be the open-vocabulary layer that plugs into ELD-BS, not a replacement for it. Treat IOSB as a possible partner as much as a rival. A 2025 state newsletter carries an article titled "ELD-BS 4.0 – Neue Technologien im digitalen Krisenmanagement" [122]; its content is unverified, so whether IOSB is already adding AI is an open question.

### 5.2 Eurocommand CommandX, on Esri ArcGIS

Why closest: Lower Saxony chose it as state-wide staff software [80], and a search excerpt attributes Schleswig-Holstein's 2026 state-wide software to Eurocommand as well (unverified) [79]. It is built on ArcGIS [82], and Esri already offers free-text feature extraction from imagery [57].

Gaps: no AI video search found in the sources; trade-fair material for the current version mentions integration of drone data [123] *(excerpt only)*.

How Erda must differ: deliver results as map layers and alerts into CommandX and ArcGIS. Do not ask a crisis staff to adopt a second situation picture. "The civil operating picture" as a product name collides with what these buyers already own.

### 5.3 Milestone Systems with BriefCam, plus Axis and Genetec

Why closest: video-management vendors with free-text search, on-premises or air-gapped [36][40], anonymisation built in [35][36], and training data that Milestone says is aligned with the EU AI Act and GDPR [36].

Gaps: these are security products tied to a video-management system; BriefCam and Genetec serve law enforcement [34][36]; none is a multi-agency civil-protection product.

How Erda must differ: work across any camera, drone or uploaded file without owning the video-management layer; have no identification function to switch on; run on CPU. The hardware figures I found published elsewhere are GPU-based: Conntour cites one consumer GPU per 50 feeds [28], Kaohsiung uses NVIDIA DGX servers [59]. Whether CPU-only matters to buyers is unverified.

### 5.4 Palantir and ChapsVision

Why closest: they are the platforms a ministry thinks of when it hears "operating picture". Palantir has been tested for exactly that in a German crisis staff [9] and has purpose prompts, audit and peering [2][10][11]. ChapsVision has been chosen over Palantir by France's DGSI [18] and, according to Politico, by Germany's BfV [17], and it was one of the four vendors of the Paris 2024 video-analytics trial [64].

Gaps: no open-vocabulary video search documented; police and intelligence focus; several German states now name digital sovereignty as the aim for police analysis software [8].

How Erda must differ: do not pitch as a Palantir alternative. On the evidence of [17] and [18], ChapsVision is ahead for that role. Pitch as the visual layer for non-police hazard response, with no person-related data model at all.

### 5.5 Linker Vision with NVIDIA

Why closest: it is the existence proof. A government runs vision-language models across its cameras for floods and fires, routes alerts across departments, and reports numbers [59][60]. The city says other Taiwanese cities can adopt the model [60].

Gaps: privacy and federation are absent from the sources; the stack depends on NVIDIA servers [59].

How Erda must differ: European legal fit, no central pooling of video, and proof of comparable detection numbers on modest hardware.

## 6. Name check

Trade-mark registers (EUIPO, DPMA) were not searched. Register status is unverified for all three names.

### Erda

No company named Erda found in government technology, defence or geospatial. Collisions elsewhere:

| Collision | Field | Severity for Erda | URL |
|---|---|---|---|
| Erda, open-source cloud-native application platform by Terminus | Software platform | Medium: same broad class of goods | https://github.com/erda-project/erda |
| ERDA, AI customer-support company, Bucharest, founded 2023 *(excerpt only)* | AI software | Low to medium | https://www.cbinsights.com/company/erda |
| ERDA, Electronic Research Data Archive, University of Copenhagen *(excerpt only)* | Research data storage | Low | https://erda.ku.dk/user-docs/html/sections/erda/overview/index.html |
| ERDAS IMAGINE, Hexagon's remote-sensing software *(excerpt only)*; used for disaster monitoring [107] | Geospatial imagery analysis | High as a near-collision: one letter apart, same domain | https://hexagon.com/products/product-groups/gis-imagery-analysis-data-management |

### Vigiles

| Collision | Field | Severity | URL |
|---|---|---|---|
| Vigiles, US offensive-security startup launched August 2023; board adviser is a former DHS chief security officer | Cybersecurity | Medium to high | https://prnewswire.com/news-releases/industry-veterans-launch-cybersecurity-startup-to-increase-access-to-offensive-security-301909317.html |
| Timesys Vigiles, vulnerability-management product for embedded Linux *(excerpt only)* | Security software | Medium to high | https://www.sourceforge.net/software/product/Timesys-Vigiles |
| Vigil AI (Roke), image classifier built with the UK Home Office and used by UK police forces *(excerpt only)* | Government visual AI | Near-collision | https://www.gov.uk/government/news/pioneering-new-tools-to-be-rolled-out-in-fight-against-child-abusers |
| Vigilant, Motorola Solutions' licence-plate recognition brand *(excerpt only)* | Police surveillance | Near-collision, and the opposite of Erda's positioning | https://www.motorolasolutions.com/en_xp/video-security-access-control/number-plate-recognition-camera-systems/vigilant-vehiclemanager-lpr-analytics-software.html |

### Lynkeus

| Collision | Field | Severity | URL |
|---|---|---|---|
| LynkEUs, EU defence project coordinated by MBDA: beyond-line-of-sight anti-tank missile with a drone supplying target data; 6.6 million euros | Defence, drones, targeting | High: a missile programme under the same name | https://esut.de/2020/07/meldungen/21566/projekt-lynkeus-fuer-die-panzerabwehr/ |
| Lynkeus S.r.l., Rome, IT services *(excerpt only)*; staff describe legal work on EU projects for privacy-enhancing technologies [115] | Privacy technology consulting | Medium | https://www.aziende.it/lynkeus-s-r-l |

### Result

Erda has the fewest collisions in the target sector. The ERDAS proximity is the one to clear with a trade-mark lawyer before spending on the brand. Vigiles is crowded in security software. Lynkeus shares its name with a weapons project, which is a poor fit for a product whose promise is civil use.

## 7. Limits and open items

- The web-search allowance for this session (200 queries) ran out before the research was complete. Later checks were done by opening known pages directly. Several rows rest on search excerpts and are marked.
- Pages that could not be opened: Schleswig-Holstein press release [79], Kommune21 article [80], IOSB IDEBOS page [71], Hexagon press release [39], Roke product page, CB Insights profile [104]. The Ruatti vendor site (www.ruatti-systems.de) did not resolve from the research environment; it either does not exist under that address or has to be allowed in the session's network settings.
- Not researched for lack of budget: Chinese-language sources on emergency-management video AI; Juvare WebEOC; Mutualink; Peregrine; Edgybees; DroneSense; Overwatch Imaging; Traversals; Aleph Alpha; Systematic SitaWare; Frequentis.
- Open questions worth one phone call each:
  1. Who built the 2026 federal pilot of the digital Lagebild, and on what technology [75][77]?
  2. What is in "ELD-BS 4.0"?
  3. Which vendor won Berlin's behaviour-analysis tender? The police have not named it [73].
  4. Is the Nordkurier report on a ChapsVision-based federal police licence correct [7]?
  5. Does any authority want video search inside the Lagebild? No source says so.
- Federation finding: "no vendor documents query-only federation for video" rests on one targeted search plus the vendor pages read. Treat it as a hypothesis.

## 8. Sources

Palantir and police analysis platforms

1. CSIS, "What Is Maven Smart System, and What Does It Do?" https://www.csis.org/analysis/what-maven-smart-system-and-what-does-it-do
2. Palantir, "Secure Collaboration" brochure, 2022. https://www.palantir.com/assets/xrfr7uokpv1b/4JWbqPQ8d6vYcNijOVqD0D/2857507783a328b6ddb6aef1ffc5fac4/Palantir_for_Secure_Collaboration__1_.pdf
3. Palantir, "Emergency Preparedness, Response, & Recovery" brochure, 2022. https://www.palantir.com/assets/xrfr7uokpv1b/1EE4kLUXymcHCQ68Xo2OzQ/8cbc5cc985ff4c3cddffdeb292c2967a/Emergency_Preparedness__Response__and_Recovery.pdf
4. DefenseScoop, 9 October 2024, Maven Smart System and Hurricane Helene. https://defensescoop.com/2024/10/09/maven-smart-system-hurricane-helene-disaster-response/
5. ZDFheute, 23 July 2025, Palantir FAQ. https://www.zdfheute.de/wissen/palantir-software-polizei-risiken-faq-100.html
6. heise online, November 2025, "Baden-Württemberg decides on the use of Palantir". https://heise.de/-11075477
7. Nordkurier, 22 July 2026, Palantir software not in operation in Baden-Württemberg. https://www.nordkurier.de/politik/palantir-software-eineinhalb-jahre-nach-dem-kauf-nicht-in-betrieb-4731071
8. ZDFheute, 22 April 2026, states and the Palantir manifesto. https://www.zdfheute.de/politik/deutschland/palantir-manifest-polizei-innenminister-bundeslaender-reaktion-kritik-100.html
9. Hessischer Landtag, Drucksache 20/2765, 22 July 2020, "Zusammenarbeit mit Palantir in Hessen". https://media.frag-den-staat.de/files/docs/c4/53/c1/c453c10631374a55a89c40a1c2df3b68/af723c5965108b4c2685ab3019d1eadc7a8e3483.pdf
10. Palantir documentation, Checkpoints overview. https://www.palantir.com/docs/foundry/checkpoints/overview/
11. Palantir documentation, Monitor audit logs *(excerpt only)*. https://www.palantir.com/docs/foundry/security/monitor-audit-logs/
12. Palantir Developer Community, "Media analysis of the video to detect labels" *(excerpt only)*. https://community.palantir.com/t/media-analysis-of-the-video-to-detect-labels/6406
13. SiliconANGLE, 19 February 2026, DHS agreement with Palantir *(excerpt only)*. https://siliconangle.com/2026/02/19/dhs-awards-palantir-1b-deploy-ai-data-analytics-platforms/
14. Direct Relief, 2012, Hurricane Sandy and Palantir *(excerpt only)*. https://www.directrelief.org/2012/10/hurricane-sandy-using-technology-for-effective-response/
15. Palantir, impact study "Coordinating Disaster Relief" (Team Rubicon) *(excerpt only)*. https://palantir.relayto.com/e/impact-study-coordinating-disaster-relief-oz0ujqqvwaw7g
16. heise online, 31 March 2026, "Phantom Palantir: Government slows down new analysis software for BKA". https://heise.de/-11242246
17. TechCentral.ie citing Politico, 18 May 2026, BfV selects ArgonOS. https://www.techcentral.ie/germany-intelligence-service-opts-for-french-palantir-alternative/
18. The Next Web, 16 June 2026, DGSI drops Palantir for ChapsVision. https://thenextweb.com/news/frances-intelligence-service-is-dropping-palantir-for-a-homegrown-rival
19. ChannelPartner (dpa), 19 May 2026, P20 and European IT. https://www.channelpartner.de/article/4172770/polizei-setzt-kunftig-auf-europaische-it.html

Video search, public-safety and defence vendors

20. Flock Safety, FreeForm product page. https://www.flocksafety.com/products/flock-freeform
21. State of Surveillance, 2026, summary of the 404 Media investigation into FreeForm audit logs. https://stateofsurveillance.org/news/flock-freeform-ai-people-search-2026/
22. Flock Safety, FlockOS page (served under the flock-nova address on 18 November 2026; it does not describe Nova). https://www.flocksafety.com/products/flock-nova
23. TechSpot, Flock drones *(excerpt only)*. https://www.techspot.com/news/113541-flock-fastest-growing-business-60-mph-police-drones.html
24. Officer.com, 8 April 2026, Axon Week 2026 AI tools. https://www.officer.com/command-hq/technology/news/55369403/axon-introduces-three-new-ai-tools-during-opening-of-axon-week-2026
25. Police1, Axon to acquire Prepared *(excerpt only)*. https://www.police1.com/police-products/real-time-crime-centers/axon-to-acquire-ai-powered-911-communications-company-prepared
26. TechCrunch, 12 December 2024, Twelve Labs *(excerpt only)*. https://techcrunch.com/2024/12/12/twelve-labs-is-building-ai-that-can-analyze-and-search-through-videos/
27. Twelve Labs job posting, Head of Public Sector Sales *(excerpt only)*. https://jobs.techstars.com/companies/twelve-labs/jobs/60954603-head-of-public-sector-sales
28. TechCrunch, 26 March 2026, Conntour. https://techcrunch.com/?p=3106434
29. Unite.AI, 26 March 2026, Conntour. https://www.unite.ai/conntour-raises-7m-to-turn-security-cameras-into-search-engines
30. Security Systems News, Ambient.ai *(excerpt only)*. https://www.securitysystemsnews.com/article/ambient-ai-launches-agentic-monitoring-investigation-tools-ahead-of-gsx-2026
31. Pulse 2.0, Coram AI Series B *(excerpt only)*. https://pulse2.com/coram-ai-raises-35-million-series-b-to-accelerate-ai-native-physical-security-platform/
32. Lumana blog, text search *(excerpt only)*. https://www.lumana.ai/blog/august-product-update-text-search-alarm-monitoring-and-more
33. Verkada blog, 8 May 2024, AI-powered search. https://verkada.com/blog/ai-powered-search
34. Officer.com, 11 February 2026, Genetec Security Center SaaS. https://www.officer.com/command-hq/technology/security-surveillance/news/55356897/genetec-inc-genetec-expands-security-center-saas-investigation-capabilities-for-large-scale-security-operations
35. Genetec, KiwiVision Privacy Protector *(excerpt only)*. https://www.genetec.com/a/privacy-protector
36. Milestone Systems, press release, 19 March 2026. https://www.milestonesys.com/press-releases/ai-built-for-security-operations/
37. Milestone Systems, Project Hafnia in Genoa *(excerpt only)*. https://www.milestonesys.com/press-releases/project-hafnia-urban-infrastructure-genoa/
38. Motorola Solutions, press release, 31 March 2025. https://www.motorolasolutions.com/newsroom/press-releases/motorola-solutions-expands-avigilon-enterprise-security-suite.html
39. Hexagon, press release, February 2026, Arlington County *(excerpt only)*. https://hexagon.com/company/newsroom/press-releases/2026/arlington-county-elevates-emergency-response-with-hexagons-ai-enhanced-cloud-based-public-safety-platform
40. Axis Communications newsroom, 23 January 2025, free text search. https://newsroom.axis.com/news/acs-pro-free-text-search
41. SecurityInfoWatch, Bosch IVA Pro Context *(excerpt only)*. https://www.securityinfowatch.com/video-surveillance/video/55318548/bosch-iva-pro-context-the-next-evolution-of-visual-intelligence
42. Dallmeier, video analytics and AI *(excerpt only)*. https://dallmeier.com/products/video-analytics-ai
43. Hikvision, AcuSeek NVR launch *(excerpt only)*. https://www.hikvision.com/ph/newsroom/latest-news/2025/hikvision-launches-groundbreaking-acuseek-nvr-redefining-video-retrieval-with-large-multimodal-ai-models
44. Defense Daily, Synthetaic *(excerpt only)*. https://www.defensedaily.com/ai-image-processing-startup-synthetaic-gets-15-million-in-new-investments/advanced-transformational-technology/
45. Defense News, 24 June 2024, Safran and Preligens *(excerpt only)*. https://www.defensenews.com/global/europe/2024/06/24/safran-in-talks-to-buy-french-ai-startup-preligens-for-220-million/
46. Breaking Defense, September 2025, Helsing *(excerpt only)*. https://breakingdefense.com/2025/09/germanys-helsing-unveils-ai-enabled-ca-1-europa-ucav-targets-2029-entry-to-service/
47. Runtime Wire, Anduril and XPRIZE Wildfire *(excerpt only)*. https://runtimewire.com/article/anduril-xprize-wildfire-autonomous-response-win
48. Contrary Research, Vannevar Labs *(excerpt only)*. https://research.contrary.com/company/vannevar-labs
49. Dataminr blog, emergency management *(excerpt only)*. https://www.dataminr.com/resources/blog/how-real-time-intelligence-strengthens-emergency-management-by-closing-the-information-gap/
50. AP via KPBS, 5 May 2026, AI wildfire detection *(excerpt only)*. https://www.kpbs.org/news/science-technology/2026/05/05/states-across-the-wildfire-prone-western-us-are-using-ai-for-early-detection
51. ICEYE, press release, Norway NVE *(excerpt only)*. https://www.iceye.com/newsroom/press-releases/norwegian-water-and-energy-authority-selects-iceye-to-deliver-nationwide-satellite-monitoring
52. One Concern, product page *(excerpt only)*. https://www.oneconcern.com/product
53. Officer.com, RapidSOS *(excerpt only)*. https://www.officer.com/command-hq/technology/communications/dispatch-technology/press-release/55260147/rapidsos-transformative-technology-to-save-lives-rapidsos-consolidates-emergency-intelligence-to-enable-911-to-make-the-right-decisions-faster
54. Skydio blog, DFR Command *(excerpt only)*. https://www.skydio.com/blog/drone-as-first-responder-integrations-25M-CFS
55. Gecko Robotics, Navy contract *(excerpt only)*. https://www.geckorobotics.com/news/navy-idiq
56. TechCrunch, 2 May 2024, Danti *(excerpt only)*. https://techcrunch.com/2024/05/02/dantis-natural-language-search-engine-for-earth-data-soars-with-5m-in-new-funding
57. Esri documentation, Using Text SAM *(excerpt only)*. https://doc.arcgis.com/en/pretrained-models/latest/imagery/using-text-sam.htm
58. Esri blog, geospatial AI in emergency management *(excerpt only)*. https://www.esri.com/en-us/industries/blog/articles/leveraging-geospatial-artificial-intelligence-in-emergency-management
59. NVIDIA, case study Linker Vision and Kaohsiung City. https://www.nvidia.com/en-us/case-studies/linker-vision-ai-smart-city-solutions/
60. Digital Today, 30 October 2026, Kaohsiung AI governance results. https://www.digitaltoday.co.kr/en/view/121903/kaohsiung-puts-ai-eyes-on-entire-city-to-spot-fires-flooding-and-potholes-first
61. UNDP, Spectee Pro profile *(excerpt only)*. https://digitalx.undp.org/SpecteePro_dx3.html
62. LCP, 20 March 2025, parliamentary evaluation of algorithmic video surveillance at the Paris Games. https://lcp.fr/actualites/videosurveillance-algorithmique-lors-des-jo-une-experimentation-pas-a-la-hauteur-selon
63. Reuters explainer via Swissinfo, Paris 2024 AI surveillance *(excerpt only)*. https://www.swissinfo.ch/eng/explainer-olympics-how-france-plans-to-use-ai-to-keep-paris-2024-safe/73485340
64. Solutions Numériques, four French vendors for the Games *(excerpt only)*. https://www.solutions-numeriques.com/la-videosurveillance-algorithmique-des-jo-confiee-a-quatre-entreprises-francaises
65. GovCIO Media, FEMA geospatial damage assessment *(excerpt only)*. https://govciomedia.com/how-geospatial-imaging-and-it-inform-femas-disaster-response/

Germany, Austria, Switzerland

66. Land Baden-Württemberg, press release, 15 November 2022, digital Lagebild. https://www.baden-wuerttemberg.de/de/service/presse/pressemitteilung/pid/digitales-lagebild-hilft-bei-krisenbewaeltigung
67. Fraunhofer IOSB, ELD-BS. https://iosb.fraunhofer.de/en/projects-and-products/electronic-situation-dashboard-civil-protection.html
68. Fraunhofer IOSB, ABUL. https://www.iosb.fraunhofer.de/en/projects-and-products/abul.html
69. Fraunhofer IOSB, ivisX. https://www.iosb.fraunhofer.de/en/projects-and-products/ivisx.html
70. Fraunhofer IOSB, IDEAL. https://www.iosb.fraunhofer.de/en/projects-and-products/ideal.html
71. Fraunhofer IOSB, IDEBOS *(excerpt only; page returned 404)*. https://iosb.fraunhofer.de/en/projects-and-products/idebos.html
72. netzpolitik.org, 18 October 2025, behaviour scanner in Mannheim. https://netzpolitik.org/2025/verhaltensscanner-im-mannheim-hier-wird-die-ueberwachung-getestet-die-so-viele-staedte-wollen/
73. netzpolitik.org, 3 July 2026, behaviour scanner in Berlin. https://netzpolitik.org/2026/software-zur-ueberwachung-berlins-ausgewaehlt-verhaltensscanner-am-kotti-startet-noch-im-sommer/
74. Bundesministerium des Innern, "Eckpunkte Pakt für den Bevölkerungsschutz", 20 May 2026. https://augengeradeaus.net/wp-content/uploads/2026/05/20260520_BMI-pakt-bevoelkerungsschutz.pdf
75. Deutscher Bundestag, Drucksache 21/7120, 10 July 2026, "Zeitenwende in der Zivilen Verteidigung". https://dserver.bundestag.de/btd/21/071/2107120.pdf
76. Bundesregierung, 24 June 2022, Gemeinsames Kompetenzzentrum Bevölkerungsschutz. https://www.bundesregierung.de/breg-de/bundesregierung/bbk-gmlz-2054798
77. BBK, Magazin Bevölkerungsschutz 4/2025, contents entry "Ein digitales Lagebild von Bund und Ländern" *(contents page only)*. https://www.kfv-ab.de/images/KFV/2026/Magazin_Bev%C3%B6lkerungsschutz_des_BBK_Ausgabe_04-2025.pdf
78. Bundesamt für Bevölkerungsschutz (Switzerland), fact sheet Lageverbundsystem, 31 March 2026. https://www.babs.admin.ch/dam/de/sd-web/lqRuYRE6l00x/2026-03-31-Faktenblatt%20Lageverbundsystem%20(LVS).pdf
79. Land Schleswig-Holstein, 29 July 2026, state-wide software for civil protection *(excerpt only; page returned 503)*. https://www.schleswig-holstein.de/DE/landesregierung/ministerien-behoerden/IV/_startseite/Artikel2026/III/260729_software_bevoelkerungsschutz
80. Kommune21, 2024, "Stabssoftware CommandX wird erprobt" *(excerpt only; page returned 404)*. https://kommune21.de/meldung_44256_Stabssoftware+CommandX+wird+erprobt.pdf
81. Interschutz, CommandX. https://www.interschutz.de/en/news/news-articles/digital-leadership-clear-and-consistent-26816
82. Esri, Eurocommand success story *(excerpt only)*. https://developers.arcgis.com/net/success-stories/eurocommand/
83. Land Nordrhein-Westfalen, press release, 23 September 2024, Digitaler Zwilling Gefahrenabwehr. https://www.land.nrw/pressemitteilung/digitaler-zwilling-gefahrenabwehr-3d-karten-unterstuetzen-im-einsatz
84. Bayerisches Innenministerium, Konzept Katastrophenschutz Bayern 2025 *(excerpt only)*. https://www.innenministerium.bayern.de/assets/stmi/sus/katastrophenschutz/kschutz_konzept_a4_web.pdf
85. DLR, MOSAIK project page. https://www.dlr.de/de/eoc/forschung-transfer/projekte-und-missionen/mosaik-multimodale-daten-und-ki-analysen-fuer-interdisziplinaere-lagebilder-im-katastrophenmanagement
86. DLR, 9 October 2026, RESITEK demonstration in Braunschweig. https://www.dlr.de/de/aktuelles/nachrichten/2026/moderne-technologien-unterstuetzen-den-katastrophenschutz
87. DLR, RESITEK project page. https://www.dlr.de/de/ki/forschung-transfer/projekte/resitek
88. Adlershof (DLR press release), June 2024, real-time situation maps. https://adlershof.de/news/echtzeit-lagebilder-fuer-den-katastrophenschutz
89. Techzeitgeist, RegioGuard-PRO. https://www.techzeitgeist.de/ki-cockpit-kommunen-krisenfall-regioguard/
90. Military Aerospace, 30 March 2026, Airbus wildfire trial. https://www.militaryaerospace.com/communications/news/55367091/airbus-links-aircraft-drones-and-ai-for-networked-wildfire-response
91. Grosswald, Quantum Systems MOSAIC UXS. https://www.grosswald.org/mosaic-uxs-quantum-systems-nato-ai-c2/
92. IABG, disaster management services *(excerpt only)*. https://iabg.de/en/services/geodata-services/katastrophenschutz-krisenmanagement
93. CIO.de, Hensoldt and Schwarz Digits *(excerpt only)*. https://www.cio.de/article/4136012/hensoldt-und-schwarz-digits-schmieden-souveraene-ruestungscloud.html
94. secunet, company site. https://www.secunet.com/en/
95. Rohde & Schwarz, critical infrastructure security *(excerpt only)*. https://www.rohde-schwarz.com/ch/_256571.html
96. TÜV Rheinland, DISMA. https://www.tuv.com/disma
97. Fireboard, product sheet *(excerpt only)*. https://fireboard.net/wp-content/uploads/2019/12/produktblatt_fireboard_grundsystem.pdf
98. DIVERA 24/7, presentation for control centres *(excerpt only)*. https://www.divera247.com/downloads/DIVERA247_Vorstellung_LST.pdf
99. EENA directory, rescueTrack *(excerpt only)*. https://companies.whoiswho.eena.org/companies/rescuetrack
100. Interschutz, VOMATEC Innovations *(excerpt only)*. https://www.interschutz.de/exhibitor/vomatec-innovations/N1602084
101. MP-BOS, company site. https://www.mpbos.de/
102. CORDIS, TEMA project *(excerpt only)*. https://cordis.europa.eu/project/id/101093003/reporting

Name check

103. GitHub, erda-project/erda. https://github.com/erda-project/erda
104. CB Insights, ERDA *(excerpt only; page returned 403)*. https://www.cbinsights.com/company/erda
105. University of Copenhagen, ERDA overview *(excerpt only)*. https://erda.ku.dk/user-docs/html/sections/erda/overview/index.html
106. Hexagon, GIS and imagery analysis products incl. ERDAS IMAGINE *(excerpt only)*. https://hexagon.com/products/product-groups/gis-imagery-analysis-data-management
107. UN-SPIDER, ERDAS software for disaster monitoring *(excerpt only)*. https://un-spider.org/es/node/5064
108. PR Newswire, 24 August 2023, Vigiles launch. https://prnewswire.com/news-releases/industry-veterans-launch-cybersecurity-startup-to-increase-access-to-offensive-security-301909317.html
109. SourceForge listing, Timesys Vigiles *(excerpt only)*. https://www.sourceforge.net/software/product/Timesys-Vigiles
110. UK Government, tools against child abuse imagery incl. Vigil AI *(excerpt only)*. https://www.gov.uk/government/news/pioneering-new-tools-to-be-rolled-out-in-fight-against-child-abusers
111. Motorola Solutions, Vigilant VehicleManager *(excerpt only)*. https://www.motorolasolutions.com/en_xp/video-security-access-control/number-plate-recognition-camera-systems/vigilant-vehiclemanager-lpr-analytics-software.html
112. ESuT, 7 July 2020, "Projekt LynkEUs für die Panzerabwehr". https://esut.de/2020/07/meldungen/21566/projekt-lynkeus-fuer-die-panzerabwehr/
113. ESuT, October 2022, Akeron MP and Lynkeus *(excerpt only)*. https://esut.de/2022/10/meldungen/37228/akeron-mp-erfolgreich-bei-lynkeus/
114. Aziende.it, Lynkeus S.r.l. *(excerpt only)*. https://www.aziende.it/lynkeus-s-r-l
115. WomenAt profile, senior legal counsel at Lynkeus *(excerpt only)*. https://womenat.com/user/lorenzo-cristofaro

Additional

116. Palantir documentation, semantic search workflow *(excerpt only)*. https://www.palantir.com/docs/foundry/ontology/using-palantir-provided-models-to-create-a-semantic-search-workflow
117. Avigilon, facial recognition product page *(excerpt only)*. https://www.avigilon.com/products/ai-video-analytics/facial-recognition
118. Public tender document quoting Genetec's Federation feature notes *(excerpt only)*. https://storage.mtender.gov.md/get/ca9f6750-5d6a-450d-89ff-599b5e619ec7-1730982516296
119. Federal Times, 3 May 2024, Danti and the Space Force *(excerpt only)*. https://federaltimes.com/it-networks/ai/2024/05/03/danti-search-engine-answers-space-force-location-questions-with-images
120. Security Sales & Integration, BriefCam adds real-time face recognition *(excerpt only)*. https://www.securitysales.com/news/briefcam-face-recognition-analytics/85187/
121. Brandwacht (Bavaria), 5/2023, Bayerisches Melde- und Lagezentrum, EPSKweb and GeoKAT *(excerpt only)*. https://prod.brandwacht.bayern.de/mam/archiv/beitraege_pdf/bw_5_2023_s214_215_baymlz__1_.pdf
122. Innenministerium Baden-Württemberg, Infodienst 2025 Kompendium, contents entry "ELD-BS 4.0" *(contents entry only; file too large to open)*. https://im.baden-wuerttemberg.de/fileadmin/redaktion/m-im/intern/dateien/pdf/20260101_Infodienst_2025_Kompendium.pdf
123. Interschutz, CommandX product entry *(excerpt only)*. https://www.interschutz.de/product/commandx/490803/N1440320
