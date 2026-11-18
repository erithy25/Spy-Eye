/**
 * German names of the scene tags. The image encoder works with the English wording (the keys);
 * the German console shows these names instead. A tag without an entry is shown as it is.
 */
export const TAG_DE: Readonly<Record<string, string>> = {
  // people, by what they do
  'group of people': 'Personengruppe', crowd: 'Menschenmenge', hands: 'Hände',
  'person walking': 'Person geht', 'person running': 'Person läuft', 'person sitting': 'Person sitzt',
  'person standing': 'Person steht', 'person talking': 'Person spricht', 'person eating': 'Person isst',
  'person drinking': 'Person trinkt', 'person cooking': 'Person kocht', 'person dancing': 'Person tanzt',
  'person sleeping': 'Person schläft', 'person reading': 'Person liest', 'person writing': 'Person schreibt',
  'person working at a computer': 'Person am Rechner', 'person using a phone': 'Person am Telefon',
  'person driving': 'Person am Steuer', 'person riding a bicycle': 'Person auf Fahrrad',
  'person riding a motorcycle': 'Person auf Motorrad', 'person riding a horse': 'Person zu Pferd',
  'person swimming': 'Person schwimmt', 'person skiing': 'Person fährt Ski', 'person surfing': 'Person surft',
  'person skateboarding': 'Person auf Skateboard', 'person climbing': 'Person klettert',
  'person playing soccer': 'Person spielt Fußball', 'person playing tennis': 'Person spielt Tennis',
  'person playing basketball': 'Person spielt Basketball', 'person playing guitar': 'Person spielt Gitarre',
  'person singing': 'Person singt', 'person giving a presentation': 'Person trägt vor',
  'person shaking hands': 'Händedruck', 'person carrying a bag': 'Person mit Tasche',
  'person holding a cup': 'Person mit Tasse', cyclist: 'Radfahrer', pedestrian: 'Fußgänger',
  // hazards and operations
  'flooded street': 'überflutete Straße', 'flooded field': 'überflutetes Feld', 'river in flood': 'Fluss mit Hochwasser',
  'floodwater around houses': 'Hochwasser an Häusern', 'fallen tree': 'umgestürzter Baum',
  'tree lying on a car': 'Baum auf Fahrzeug', debris: 'Treibgut und Schutt', rubble: 'Trümmer',
  'collapsed building': 'eingestürztes Gebäude', 'damaged road': 'beschädigte Fahrbahn', landslide: 'Erdrutsch',
  'burning building': 'brennendes Gebäude', flames: 'Flammen', wildfire: 'Flächenbrand', 'car accident': 'Verkehrsunfall',
  'overturned truck': 'umgestürzter Lastwagen', 'rescue boat': 'Rettungsboot', 'emergency vehicles': 'Einsatzfahrzeuge',
  'rescue operation': 'Rettungseinsatz', sandbags: 'Sandsäcke', 'damaged roof': 'beschädigtes Dach', dam: 'Staumauer',
  dike: 'Deich',
  // vehicles
  car: 'Pkw', taxi: 'Taxi', 'police car': 'Polizeifahrzeug', 'sports car': 'Sportwagen', van: 'Transporter',
  'pickup truck': 'Pritschenwagen', truck: 'Lastwagen', bus: 'Bus', 'school bus': 'Schulbus', train: 'Zug',
  tram: 'Straßenbahn', 'subway train': 'U-Bahn', motorcycle: 'Motorrad', scooter: 'Roller', bicycle: 'Fahrrad',
  airplane: 'Flugzeug', helicopter: 'Hubschrauber', boat: 'Boot', ship: 'Schiff', sailboat: 'Segelboot',
  ambulance: 'Rettungswagen', 'fire truck': 'Löschfahrzeug', tractor: 'Traktor', forklift: 'Gabelstapler',
  drone: 'Drohne', 'traffic jam': 'Stau', 'parked car': 'parkendes Fahrzeug', crane: 'Kran',
  // street
  street: 'Straße', highway: 'Autobahn', intersection: 'Kreuzung', crosswalk: 'Fußgängerüberweg',
  sidewalk: 'Gehweg', 'traffic light': 'Ampel', 'stop sign': 'Stoppschild', 'road sign': 'Verkehrsschild',
  'parking lot': 'Parkplatz', 'parking garage': 'Parkhaus', 'gas station': 'Tankstelle', bridge: 'Brücke',
  tunnel: 'Tunnel', roundabout: 'Kreisverkehr', 'bus stop': 'Haltestelle', 'train station': 'Bahnhof',
  airport: 'Flughafen', harbor: 'Hafen', 'construction site': 'Baustelle', 'street at night': 'Straße bei Nacht',
  'railway track': 'Gleis', 'power line': 'Stromleitung', 'wind turbine': 'Windrad',
  // animals
  dog: 'Hund', cat: 'Katze', horse: 'Pferd', cow: 'Kuh', sheep: 'Schaf', pig: 'Schwein', chicken: 'Huhn',
  bird: 'Vogel', duck: 'Ente', fish: 'Fisch', shark: 'Hai', whale: 'Wal', dolphin: 'Delfin', elephant: 'Elefant',
  giraffe: 'Giraffe', zebra: 'Zebra', lion: 'Löwe', tiger: 'Tiger', bear: 'Bär', monkey: 'Affe', deer: 'Reh',
  rabbit: 'Kaninchen', squirrel: 'Eichhörnchen', snake: 'Schlange', butterfly: 'Schmetterling', bee: 'Biene',
  spider: 'Spinne',
  // objects
  cup: 'Tasse', 'coffee mug': 'Kaffeebecher', glass: 'Glas', bottle: 'Flasche', 'wine glass': 'Weinglas',
  'plate of food': 'Teller mit Essen', bowl: 'Schale', knife: 'Messer', fork: 'Gabel', laptop: 'Laptop',
  'computer monitor': 'Bildschirm', keyboard: 'Tastatur', smartphone: 'Smartphone', tablet: 'Tablet',
  television: 'Fernseher', camera: 'Kamera', microphone: 'Mikrofon', headphones: 'Kopfhörer', book: 'Buch',
  newspaper: 'Zeitung', document: 'Schriftstück', whiteboard: 'Tafel', clock: 'Uhr', watch: 'Armbanduhr',
  backpack: 'Rucksack', handbag: 'Handtasche', suitcase: 'Koffer', umbrella: 'Regenschirm', chair: 'Stuhl',
  couch: 'Sofa', bed: 'Bett', table: 'Tisch', desk: 'Schreibtisch', lamp: 'Lampe', door: 'Tür', window: 'Fenster',
  stairs: 'Treppe', elevator: 'Aufzug', refrigerator: 'Kühlschrank', oven: 'Backofen', sink: 'Spülbecken',
  toilet: 'Toilette', ball: 'Ball', guitar: 'Gitarre', piano: 'Klavier', 'drum kit': 'Schlagzeug', toy: 'Spielzeug',
  balloon: 'Ballon', flag: 'Fahne', box: 'Kiste', 'shopping cart': 'Einkaufswagen', shelf: 'Regal', tool: 'Werkzeug',
  machine: 'Maschine', robot: 'Roboter', money: 'Geld', 'credit card': 'Kreditkarte', key: 'Schlüssel',
  fence: 'Zaun', bench: 'Bank', 'fire hydrant': 'Hydrant', 'trash can': 'Abfalleimer', ladder: 'Leiter',
  tent: 'Zelt', 'screen with text': 'Bildschirm mit Text', chart: 'Diagramm', map: 'Karte', logo: 'Logo',
  'sign with text': 'Schild mit Text', poster: 'Plakat', painting: 'Gemälde', flowers: 'Blumen',
  'christmas tree': 'Weihnachtsbaum', candle: 'Kerze', cake: 'Kuchen',
  // food
  pizza: 'Pizza', burger: 'Burger', sandwich: 'belegtes Brot', pasta: 'Nudeln', sushi: 'Sushi', salad: 'Salat',
  fruit: 'Obst', vegetables: 'Gemüse', bread: 'Brot', coffee: 'Kaffee', beer: 'Bier', wine: 'Wein',
  'ice cream': 'Eis', barbecue: 'Grill',
  // places indoor
  office: 'Büro', 'meeting room': 'Besprechungsraum', kitchen: 'Küche', 'living room': 'Wohnzimmer',
  bedroom: 'Schlafzimmer', bathroom: 'Bad', restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar',
  supermarket: 'Supermarkt', shop: 'Laden', 'shopping mall': 'Einkaufszentrum', warehouse: 'Lagerhalle',
  factory: 'Fabrik', laboratory: 'Labor', hospital: 'Krankenhaus', classroom: 'Klassenraum', library: 'Bibliothek',
  gym: 'Sporthalle', stadium: 'Stadion', concert: 'Konzert', theater: 'Theater', church: 'Kirche', museum: 'Museum',
  hallway: 'Flur', lobby: 'Eingangshalle', garage: 'Garage', 'server room': 'Serverraum', 'tv studio': 'Fernsehstudio',
  'hotel room': 'Hotelzimmer',
  // places outdoor
  'city skyline': 'Stadtsilhouette', skyscraper: 'Hochhaus', house: 'Haus', 'apartment building': 'Wohnblock',
  garden: 'Garten', park: 'Park', playground: 'Spielplatz', forest: 'Wald', mountain: 'Berg', beach: 'Strand',
  ocean: 'Meer', lake: 'See', river: 'Fluss', waterfall: 'Wasserfall', desert: 'Wüste', field: 'Feld', farm: 'Hof',
  village: 'Dorf', 'snowy landscape': 'Schneelandschaft', 'swimming pool': 'Schwimmbecken', 'golf course': 'Golfplatz',
  'soccer field': 'Fußballplatz', 'tennis court': 'Tennisplatz', 'ski slope': 'Skipiste', campsite: 'Zeltplatz',
  market: 'Markt', festival: 'Fest', wedding: 'Hochzeit', parade: 'Umzug', castle: 'Burg', monument: 'Denkmal',
  // conditions and shot types
  night: 'Nacht', sunset: 'Sonnenuntergang', sunrise: 'Sonnenaufgang', rain: 'Regen', snow: 'Schnee', fog: 'Nebel',
  fire: 'Feuer', smoke: 'Rauch', explosion: 'Explosion', water: 'Wasser', clouds: 'Wolken', 'blue sky': 'blauer Himmel',
  storm: 'Sturm', lightning: 'Blitz', fireworks: 'Feuerwerk', 'close-up shot': 'Nahaufnahme', 'aerial view': 'Luftbild',
  'wide landscape shot': 'Totale einer Landschaft', 'black and white image': 'Schwarzweißbild',
  'animated cartoon': 'Zeichentrick', 'video game': 'Videospiel', 'screenshot of a computer screen': 'Bildschirmfoto',
  'text on screen': 'Text im Bild', 'title card': 'Titeltafel', 'blurry image': 'unscharfes Bild', 'dark scene': 'dunkle Szene',
  'security camera footage': 'Überwachungskamera', 'dashcam footage': 'Fahrzeugkamera', 'underwater scene': 'Unterwasser',
  'news broadcast': 'Nachrichtensendung', interview: 'Interview', 'sports broadcast': 'Sportübertragung',
  // colours on common subjects
  'red car': 'roter Pkw', 'black car': 'schwarzer Pkw', 'white car': 'weißer Pkw', 'blue car': 'blauer Pkw',
  'silver car': 'silberner Pkw', 'yellow car': 'gelber Pkw', 'green car': 'grüner Pkw', 'red bus': 'roter Bus',
  'green bus': 'grüner Bus', 'yellow bus': 'gelber Bus', 'white van': 'weißer Transporter', 'white truck': 'weißer Lastwagen',
};

/** Name of a scene tag in the language of the console. */
export function tagLabel(label: string, lang: 'de' | 'en'): string {
  return lang === 'de' ? (TAG_DE[label] ?? label) : label;
}
