/**
 * Screens search and watch prompts before they reach the model.
 *
 * The platform answers questions about scenes, objects and events. It must not be usable to
 * single out a named individual or to sort people by protected characteristics:
 *   - AI Act Art. 5(1)(g): biometric categorisation by sensitive attributes is prohibited;
 *   - GDPR Art. 9: special categories of personal data;
 *   - the vision model has seen public figures in training, so a name is effectively a face query.
 *
 * The screen is deliberately conservative and rule-based: it is auditable, and every refusal is
 * written to the ledger with the rule that fired.
 */

export interface GuardVerdict {
  allowed: boolean;
  /** Machine-readable rule id, e.g. `protected-attribute`. */
  rule: string | null;
  reason: string | null;
  reasonEn: string | null;
  /**
   * Remarks on an allowed prompt that an auditor should be able to filter for, e.g.
   * `person-description` when the prompt describes people by sex or age group.
   */
  flags: string[];
}

export interface GuardOptions {
  /** Whether the mandate permits describing persons by sex or age group. */
  personDescriptions: boolean;
}

/** Terms that sort people by origin, religion, health, sexuality or political stance. */
const PROTECTED_TERMS: readonly string[] = [
  // origin / ethnicity
  'ethnic', 'ethnicity', 'racial', 'skin color', 'skin colour', 'dark-skinned', 'dark skinned', 'light-skinned',
  'gypsy', 'roma', 'sinti', 'foreigner', 'foreign-looking', 'immigrant', 'migrant', 'refugee', 'jewish looking',
  'arabic looking',
  // religion
  'muslim', 'moslem', 'islamic', 'jew', 'jews', 'jewish', 'christian', 'hindu', 'sikh', 'buddhist', 'hijab', 'headscarf',
  'kippah', 'yarmulke', 'turban', 'burqa', 'niqab', 'kopftuch', 'religious',
  // sexuality / gender identity
  'gay', 'lesbian', 'homosexual', 'transgender', 'trans person', 'queer', 'lgbt',
  // health as a sorting criterion
  'mentally ill', 'hiv', 'pregnant',
  // politics
  'antifa', 'communist', 'nazi', 'activist', 'union member', 'gewerkschaft',
];

/** German word stems for the same thing; matched anywhere in a word to cover inflection. */
const PROTECTED_STEMS: readonly string[] = [
  'auslander', 'auslandisch', 'sudlander', 'sudlandisch', 'fluchtling', 'migrant', 'dunkelhautig', 'hautfarbe',
  'zigeuner', 'asylbewerber', 'moslem', 'muslim', 'homosexuell',
];

/**
 * Words that are harmless for objects ("asian restaurant", "white van", "black smoke") and only
 * become a protected attribute when they describe a person.
 */
const ORIGIN_ADJECTIVES: readonly string[] = [
  'black', 'white', 'asian', 'african', 'arab', 'arabic', 'hispanic', 'latino', 'latina', 'caucasian', 'turkish',
  'syrian', 'afghan', 'polish', 'russian', 'romanian', 'chinese', 'indian', 'foreign',
];
const PERSON_NOUNS: readonly string[] = [
  'person', 'persons', 'people', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'child', 'children',
  'kid', 'kids', 'guy', 'guys', 'male', 'males', 'female', 'females', 'youth', 'youths', 'teenager', 'teenagers',
  'family', 'families', 'driver', 'suspect', 'individual', 'individuals', 'mann', 'manner', 'frau', 'frauen', 'leute',
  'personen', 'jugendliche', 'kinder',
];

/**
 * Bodily features that single a person out. The AI Act (recital 16) counts hair colour, eye
 * colour and tattoos among biometric categories; this system does not sort people by them.
 */
const IDENTIFYING_FEATURES: readonly string[] = [
  'hair', 'haired', 'blond', 'blonde', 'brunette', 'redhead', 'bald', 'beard', 'bearded', 'moustache', 'mustache',
  'tattoo', 'tattoos', 'tattooed', 'scar', 'scarred', 'birthmark', 'piercing', 'freckles', 'eye color', 'eye colour',
  'blue eyes', 'brown eyes', 'green eyes', 'haare', 'haarfarbe', 'bart', 'tatowierung', 'tatowiert', 'narbe', 'glatze',
];

/** Words that describe a person by sex or age group. Allowed only where the mandate says so. */
const SEX_AGE_TERMS: readonly string[] = [
  'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'male', 'female', 'lady', 'gentleman', 'guy', 'guys',
  'child', 'children', 'kid', 'kids', 'baby', 'babies', 'toddler', 'infant', 'teenager', 'teenagers', 'teen', 'youth',
  'elderly', 'senior', 'seniors', 'old man', 'old woman', 'young man', 'young woman', 'mann', 'manner', 'frau', 'frauen',
  'junge', 'madchen', 'kind', 'kinder', 'jugendliche', 'jugendlicher', 'senioren', 'greis',
];

/** Phrases that ask for identification, re-identification or tracking rather than description. */
const IDENTITY_PHRASES: readonly string[] = [
  // who is it
  'who is', 'who are', 'identify', 'identity', 'name of the', 'wer ist', 'wer sind', 'identifizier', 'identitat',
  // faces
  'face of', 'faces of', 'facial recognition', 'face recognition', 'face match', 'recognize the person',
  'recognise the person', 'recognize him', 'recognize her', 'recognise him', 'recognise her', 'gesichtserkennung',
  'gesicht von', 'gesicht des', 'gesicht der', 'gesicht dieser', 'gesicht dieses', 'gesicht eines', 'gesicht einer',
  'gesichter von', 'gesichter der', 'gesichter erkennen', 'erkenne die person', 'erkenne den mann', 'erkenne die frau',
  // one particular individual, again
  'find this person', 'this person', 'that person', 'this man', 'that man', 'this woman', 'that woman', 'same person',
  'same man', 'same woman', 'the person from', 'the man from', 'the woman from', 'find him', 'find her', 'where is he',
  'where is she', 'diese person', 'dieser person', 'diesen mann', 'dieser mann', 'diese frau', 'dieser frau',
  'dieselbe person', 'derselbe mann', 'dieselbe frau', 'person wieder', 'personen wieder', 'mann wieder', 'frau wieder',
  'wiedererkenn', 'finde ihn', 'finde sie wieder', 'wo ist er', 'wo ist sie',
  // tracking
  'track the person', 'follow the person', 'track him', 'track her', 'follow him', 'follow her', 'person tracking',
  'movement profile', 'verfolge', 'bewegungsprofil', 'bewegungsbild',
];

/** Any mention of a vehicle registration: this system does not read or search licence plates. */
const PLATE_PHRASES: readonly string[] = [
  'license plate', 'licence plate', 'number plate', 'numberplate', 'registration plate', 'registration number',
  'plate number', 'vehicle registration', 'kennzeichen', 'nummernschild', 'nummernschilder', 'zulassungsnummer',
];

/** A German registration as written ("KO AB 123", "M-XY 4711"); checked on the text as typed. */
const GERMAN_PLATE = /(^|[^A-Za-zÄÖÜäöü])[A-ZÄÖÜ]{1,3}[ -][A-Z]{1,2}[ -]?\d{1,4}[EH]?($|[^0-9A-Za-z])/;

/** Clothing and things carried: they describe a person without being biometric features. */
const CLOTHING_TERMS: readonly string[] = [
  'jacket', 'coat', 'hoodie', 'hood', 'shirt', 't-shirt', 'sweater', 'pullover', 'dress', 'skirt', 'trousers', 'pants',
  'jeans', 'shorts', 'hat', 'cap', 'beanie', 'backpack', 'rucksack', 'handbag', 'sneakers', 'boots', 'wearing', 'dressed',
  'jacke', 'mantel', 'kapuze', 'kapuzenpullover', 'hemd', 'kleid', 'rock', 'hose', 'mutze', 'kappe', 'tragt', 'gekleidet',
  'bekleidet',
];

/**
 * Frequent given names (German, English, Turkish, Arabic, Slavic, Romance). A name in a prompt
 * means the query targets an individual. Names that are also everyday words (max, mark, iris, …)
 * are left out on purpose: a missed name still only yields scene matches, a false refusal blocks
 * legitimate work.
 */
const GIVEN_NAMES: ReadonlySet<string> = new Set(
  (
    'aaron abdul achim adrian ahmed ahmet albert alexander alexandra alice alina amelie andrea andreas angela ' +
    'angelika anja anke anna annette anton antonia armin arne astrid aylin ayse barbara bastian beate benjamin ' +
    'bernd bernhard bettina bianca birgit bjorn boris brigitte carina carlos carolin caroline carsten catherine ' +
    'charlotte christa christian christiane christin christina christine christoph claudia claus clemens ' +
    'cornelia dagmar daniel daniela david dennis detlef dieter dietmar dirk dmitri dominik donald doris dorothea ' +
    'edith eduard elena elias elif elisabeth elke ellen emilia emily emre erika erwin esra fabian fatih fatima ' +
    'fatma felix florian franz franziska frederik friedrich fritz gabi gabriel gabriele georg gerda gerhard ' +
    'gertrud gisela giuseppe gregor greta gudrun guido gunter gustav hakan hamza hanna hannah hannes harald ' +
    'hasan hassan heidi heike heiko heinrich heinz helen helena helene helga helmut hendrik henrik herbert ' +
    'hermann hildegard holger horst hubert hussein ibrahim ingrid irina isabel isabell isabella ivan jakob ' +
    'janina jannik jasmin jennifer jens jessica joachim jochen johann johanna johannes jonas jonathan jorg josef ' +
    'joseph julian juliane jurgen jutta karin karla karsten katharina kathrin katja katrin kemal kerstin kevin ' +
    'khalid klaus konrad konstantin kristin leah leonie liam lothar louisa lucas ludwig luisa lukas magdalena ' +
    'mahmoud maja malte manfred manuel manuela marcel marcus mareike margarete maria marianne marie marina ' +
    'marion marius markus marlene marta martha martin martina mathias matthias maximilian mehmet melanie melissa ' +
    'meryem michael michaela michelle miriam mohamed mohammad mohammed monika moritz muhammad murat mustafa ' +
    'nadine nadja natalie natascha nicolas nicole niklas nina norbert olaf oleg olga oliver omar oskar pascal ' +
    'patricia patrick paul paulina pawel peter petra philip philipp piotr rainer ralph ramona raphael rebecca ' +
    'regina reinhard renate roland rosemarie rudolf sabine sabrina sarah sascha sebastian selin sergej sibylle ' +
    'siegfried sigrid silke silvia simon simone sofia sonja sophia sophie stefan stefanie steffen stephan ' +
    'stephanie susanne svenja svetlana sylvia tamara tanja tatjana theodor theresa thomas thorsten timo tobias ' +
    'torsten ulrich ulrike ursula valentin vanessa verena veronika viktor viktoria vladimir volker walter ' +
    'waltraud werner wilhelm wladimir wolfgang yasemin yusuf yvonne zeynep ' +
    // public figures frequently used to test such systems
    'merkel scholz merz trump biden putin macron obama selenskyj zelensky habeck baerbock lindner soder musk'
  ).split(' '),
);

/** Titles after which a personal name follows. */
const NAME_TITLES: readonly string[] = ['mr', 'mrs', 'ms', 'mister', 'dr', 'prof'];
/**
 * German forms of address that are also ordinary nouns ("eine Frau mit Kinderwagen"). They only
 * announce a name when the next word is capitalised as typed ("Frau Müller", "Herrn Schmidt").
 */
const NAME_NOUN_MARKERS: readonly string[] = ['herr', 'herrn', 'frau', 'familie', 'minister', 'ministerin', 'kanzler', 'kanzlerin', 'president'];

/** Lower-case, diacritics removed, whitespace collapsed. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(normalized: string): string[] {
  return normalized.split(/[^a-z0-9-]+/).filter((t) => t !== '');
}

/** Tokens with the capitalisation as typed, aligned with `tokens(normalize(text))`. */
function casedTokens(raw: string): string[] {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .split(/[^A-Za-z0-9-]+/)
    .filter((t) => t !== '');
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match that also accepts a plural "s"; inflected German forms match by stem. */
const PROTECTED_PATTERNS: readonly { term: string; pattern: RegExp }[] = PROTECTED_TERMS.map((term) => {
  const norm = normalize(term);
  return { term, pattern: new RegExp(`(^|[^a-z])${escapeRegExp(norm)}(s|e|er|en|em|es|isch\\w*)?($|[^a-z])`) };
});
const IDENTITY_NORMALIZED: readonly string[] = IDENTITY_PHRASES.map(normalize);
const PLATE_NORMALIZED: readonly string[] = PLATE_PHRASES.map(normalize);

const refuse = (rule: string, reason: string, reasonEn: string): GuardVerdict => ({
  allowed: false,
  rule,
  reason,
  reasonEn,
  flags: [],
});

const containsTerm = (text: string, words: readonly string[], term: string): boolean =>
  term.includes(' ') ? text.includes(term) : words.includes(term);

export function screenPrompt(raw: string, options: GuardOptions = { personDescriptions: true }): GuardVerdict {
  const text = normalize(raw);
  const words = tokens(text);
  const cased = casedTokens(raw);

  if (PLATE_NORMALIZED.some((phrase) => text.includes(phrase)) || GERMAN_PLATE.test(raw)) {
    return refuse(
      'licence-plate',
      'Die Anfrage betrifft ein Kennzeichen. Dieses System liest und sucht keine Kennzeichen; über sie ließen sich Halter ermitteln.',
      'The request concerns a licence plate. This system neither reads nor searches licence plates; they would lead to the keeper.',
    );
  }
  for (const phrase of IDENTITY_NORMALIZED) {
    if (text.includes(phrase)) {
      return refuse(
        'identification',
        'Die Anfrage zielt darauf, eine bestimmte Person zu erkennen, wiederzufinden oder zu verfolgen. Dieses System beschreibt Lagen, es identifiziert niemanden.',
        'The request aims at recognising, finding again or tracking a particular person. This system describes situations; it identifies no one.',
      );
    }
  }
  const protectedTerm =
    PROTECTED_PATTERNS.find(({ pattern }) => pattern.test(text))?.term ??
    PROTECTED_STEMS.find((stem) => text.includes(stem)) ??
    // "<origin adjective> <person noun>", with at most one word in between ("black young man").
    ORIGIN_ADJECTIVES.find((adjective) =>
      words.some((w, i) => w === adjective && words.slice(i + 1, i + 3).some((n) => PERSON_NOUNS.includes(n))),
    );
  if (protectedTerm !== undefined) {
    return refuse(
      'protected-attribute',
      `Die Anfrage sortiert Menschen nach einem geschützten Merkmal („${protectedTerm}“). Das ist ausgeschlossen (Art. 9 DSGVO, Art. 5 KI-Verordnung).`,
      `The request sorts people by a protected characteristic ("${protectedTerm}"). This is excluded (GDPR Art. 9, AI Act Art. 5).`,
    );
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    const next = words[i + 1];
    const nextAsTyped = cased[i + 1] ?? '';
    const titled = NAME_TITLES.includes(word) && next !== undefined && next.length > 2;
    const addressed = NAME_NOUN_MARKERS.includes(word) && next !== undefined && next.length > 2 && /^[A-Z][a-z]/.test(nextAsTyped);
    if (GIVEN_NAMES.has(word) || titled || addressed) {
      return refuse(
        'named-person',
        'Die Anfrage enthält einen Personennamen. Die Suche nach benannten Personen ist ausgeschlossen.',
        'The request contains a personal name. Searching for named individuals is excluded.',
      );
    }
  }

  // Bodily features only matter when the prompt is about a person ("a red-haired woman"), not
  // about an animal or an object ("a dog with long hair" still describes a scene).
  const aboutPerson = [...PERSON_NOUNS, ...SEX_AGE_TERMS].some((noun) => containsTerm(text, words, noun));
  const feature = IDENTIFYING_FEATURES.find((term) => containsTerm(text, words, term));
  if (aboutPerson && feature !== undefined) {
    return refuse(
      'identifying-feature',
      `Die Anfrage beschreibt eine Person über ein körperliches Merkmal („${feature}“). Solche Merkmale gelten als biometrische Kategorien (KI-Verordnung, Erwägungsgrund 16) und sind hier ausgeschlossen. Kleidung, Ausrüstung, Haltung und Situation sind zulässig.`,
      `The request describes a person by a bodily feature ("${feature}"). Such features count as biometric categories (AI Act, recital 16) and are excluded here. Clothing, equipment, posture and situation are permitted.`,
    );
  }

  // Describing a person by sex, age group or clothing narrows a search down towards individuals.
  // It is needed for some tasks (a missing child, a person reported in the water) and therefore
  // depends on the mandate; where it is allowed, the prompt is marked for the auditor.
  const sexAge = SEX_AGE_TERMS.find((term) => containsTerm(text, words, term));
  const clothing = aboutPerson ? CLOTHING_TERMS.find((term) => containsTerm(text, words, term)) : undefined;
  const describing = sexAge ?? clothing;
  if (describing !== undefined) {
    if (!options.personDescriptions) {
      return refuse(
        'person-description',
        `Dieses Mandat lässt keine Beschreibung von Personen nach Geschlecht, Alter oder Kleidung zu („${describing}“). Bitte neutral formulieren, zum Beispiel „person“.`,
        `This mandate does not permit describing persons by sex, age group or clothing ("${describing}"). Please use a neutral wording such as "person".`,
      );
    }
    return { allowed: true, rule: null, reason: null, reasonEn: null, flags: ['person-description'] };
  }
  return { allowed: true, rule: null, reason: null, reasonEn: null, flags: [] };
}
