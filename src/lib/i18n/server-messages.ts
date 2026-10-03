// User-facing strings produced by the journey planner (server side).
// Street, stop and place names stay as in the source data; only our own words are translated.
import { defaultLocale, isLocale, type Locale } from './locales';

type PluralForms = { one: string; few?: string; many?: string; other: string };
type Direction = 'up' | 'down' | 'unknown';
type Handrail = 'yes' | 'no' | 'unknown';

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** CLDR plural category (pl: one, few, many, other; en/de: one, other). */
export function plural(locale: Locale, n: number, forms: PluralForms) {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)));
  const category = rules.select(n) as keyof PluralForms;
  return forms[category] ?? forms.other;
}

// Taxi fare basis (see drive.ts and docs/DATA-SOURCES.md for the tariff source).
const FARE_BASIS_PL = 'Szacunek wg maksymalnych stawek taksówek w Krakowie (strefa I, taryfa 1–2, +20% na korki)';
const FARE_BASIS_EN = 'Estimate from Kraków maximum taxi rates (zone I, tariff 1–2, +20% for traffic)';
const FARE_BASIS_DE = 'Schätzung nach den Krakauer Taxi-Höchstpreisen (Zone I, Tarif 1–2, +20 % für Stau)';

const numberLocale: Record<Locale, string> = { pl: 'pl-PL', en: 'en-GB', de: 'de-DE' };

function distance(locale: Locale, units: { m: string; km: string }) {
  return (m: number) =>
    m < 1000
      ? `${Math.round(m)} ${units.m}`
      : `${(m / 1000).toLocaleString(numberLocale[locale], { maximumFractionDigits: 1 })} ${units.km}`;
}

const pl = {
  distance: distance('pl', { m: 'm', km: 'km' }),
  labels: {
    preferred: 'Dopasowana do dzisiaj',
    shortest: 'Najkrótsza',
    alternative: 'Inny przebieg',
    tram: (line: string) => `Tramwaj ${line}`,
    bus: (line: string) => `Autobus ${line}`,
    taxi: 'Taksówka',
    car: (parking: string) => `Samochód · ${parking}`,
    carDropOff: 'Samochód · podjazd pod cel',
  },
  places: {
    pickup: 'Miejsce odbioru',
    dropOff: 'Miejsce wysiadania',
    carStart: 'Samochód',
    parking: 'Parking',
    disabledSpace: 'Miejsce dla osób z niepełnosprawnością',
    parkingNear: (d: string) => `parking ${d} od celu`,
    disabledSpaceNear: (d: string) => `miejsce dla osób z niepełnosprawnością ${d} od celu`,
  },
  steps: {
    go: 'Idź',
    straight: 'Prosto',
    right: 'Skręć w prawo',
    left: 'Skręć w lewo',
    back: 'Zawróć',
    along: (turn: string, label: string) => `${turn}: ${label}`,
    cross: 'Przejdź przez jezdnię',
    turnAndCross: (turn: string) => `${turn} i przejdź przez jezdnię`,
    destination: (name: string) => `Cel: ${name}`,
    walkTo: (name: string) => `Przejdź do: ${name} (przebieg pieszy nieznany)`,
    foot: 'chodnik lub ścieżka',
    service: 'droga dojazdowa',
    street: 'ulica bez nazwy',
    crossing: 'przejście przez jezdnię',
    stairs: 'schody',
  },
  facts: {
    stairs: (direction: Direction, steps: number | null) =>
      `Schody ${{ up: 'w górę', down: 'w dół', unknown: 'o nieznanym kierunku' }[direction]}${steps ? ` · ${steps} ${plural('pl', steps, { one: 'stopień', few: 'stopnie', many: 'stopni', other: 'stopnia' })}` : ''}`,
    handrail: (value: Handrail) => `poręcz: ${{ yes: 'jest', no: 'brak', unknown: 'brak danych' }[value]}`,
    bench: 'Ławka',
    benchBackrest: 'Ławka z oparciem',
    toilet: (name: string | null, limited: boolean) => `${limited ? 'Toaleta częściowo dostępna' : 'Toaleta dostępna'}${name ? ` · ${name}` : ''}`,
    entrance: 'Wejście',
    mainEntrance: 'Wejście główne',
    kerbRaised: 'Krawężnik bez obniżenia',
    kerbUnknown: 'Krawężnik o nieznanej wysokości',
    kerbRolled: 'Krawężnik skośny',
    step: 'Próg lub przeszkoda',
    nodeNoWheelchair: 'Przejście oznaczone jako niedostępne dla wózków',
    sett: (d: string) => `Bruk · ${d}`,
    rough: (d: string) => `Nierówna nawierzchnia · ${d}`,
    steep: (d: string) => `Strome nachylenie · ${d}`,
    narrow: (d: string) => `Wąskie przejście (< 0,9 m) · ${d}`,
    noWheelchair: (d: string) => `Odcinek niedostępny dla wózków · ${d}`,
    impassable: (d: string) => `Nawierzchnia nieprzejezdna · ${d}`,
  },
  issues: {
    stairs: (n: number) => (n > 1 ? `Schody na trasie (${n})` : 'Schody na trasie'),
    stairsUp: 'Schody w górę',
    stairsDown: 'Schody w dół',
    stairsUnknown: 'Schody o nieznanym kierunku',
    stairsNoHandrail: (n: number) => (n > 1 ? `Schody bez poręczy (${n})` : 'Schody bez poręczy'),
    stairsHandrailUnknown: (n: number) => (n > 1 ? `Schody bez danych o poręczy (${n})` : 'Schody bez danych o poręczy'),
    longStairs: (n: number) => (n > 1 ? `Długie schody, ponad 15 stopni (${n})` : 'Długie schody, ponad 15 stopni'),
    noBench: (minute: number) => `Brak ławki ok. ${minute}. minuty`,
    overLimit: (d: string) => `Ponad Twój limit ${d}`,
    kerbRaised: (n: number) => (n > 1 ? `Krawężniki bez obniżenia (${n})` : 'Krawężnik bez obniżenia'),
    kerbUnknown: (n: number) => (n > 1 ? `Krawężniki o nieznanej wysokości (${n})` : 'Krawężnik o nieznanej wysokości'),
    step: (n: number) => (n > 1 ? `Progi lub przeszkody (${n})` : 'Próg lub przeszkoda'),
    sett: (d: string) => `Bruk na ${d}`,
    rough: (d: string) => `Nierówna nawierzchnia na ${d}`,
    steep: (d: string) => `Strome nachylenie na ${d}`,
    narrow: 'Wąskie przejście (< 0,9 m)',
    noWheelchair: 'Odcinek oznaczony jako niedostępny dla wózków',
    impassable: 'Nawierzchnia oznaczona jako nieprzejezdna',
    tripUnknown: 'Kurs bez informacji o przystosowaniu',
    tripNotAccessible: 'Kurs oznaczony jako nieprzystosowany',
    stopNotAccessible: 'Przystanek oznaczony jako nieprzystosowany',
    noDisabledParking: (d: string) => `Brak parkingu z miejscami dla osób z niepełnosprawnością w promieniu ${d}`,
    noParking: (d: string) => `Brak parkingu w promieniu ${d}`,
    accessibleTaxi: 'Zamów pojazd przystosowany do wózka',
  },
  fare: {
    basis: FARE_BASIS_PL,
  },
  errors: {
    offNetwork: 'Punkt jest zbyt daleko od znanej sieci pieszej. Wybierz pobliską ulicę lub przystanek.',
    noPreferredWalk: 'Nie ma trasy pieszej bez schodów, których dziś unikasz. Pokazujemy najkrótszą.',
    noBarrierFreeWalk: 'Nie ma trasy bez barier dla wózka. Pokazujemy najkrótszą — sprawdź oznaczone miejsca.',
    walkFailed: 'Nie udało się wyznaczyć trasy pieszej.',
    transitFailed: 'Nie udało się wyznaczyć połączenia komunikacją.',
    transitUnavailable: 'Rozkład jazdy ZTP jest niedostępny. Pokazujemy tylko trasy piesze.',
    noStartStop: 'Brak przystanku w zasięgu dojścia od startu.',
    noEndStop: 'Brak przystanku w zasięgu dojścia do celu.',
    noService: 'Brak kursów ZTP w wybranym dniu i godzinie.',
    noConnection: 'Brak połączenia komunikacją w ciągu najbliższych godzin.',
    roadsUnavailable: 'Dane drogowe są niedostępne. Pokazujemy komunikację i trasy piesze.',
    offRoad: 'Punkt jest zbyt daleko od drogi dla samochodów.',
    driveFailed: 'Nie udało się wyznaczyć przejazdu samochodem.',
    badRequest: 'Sprawdź punkty, datę i godzinę.',
    serverError: 'Nie udało się przygotować podróży. Spróbuj ponownie.',
  },
};

export type ServerMessages = typeof pl;

const en: ServerMessages = {
  distance: distance('en', { m: 'm', km: 'km' }),
  labels: {
    preferred: 'Matched to today',
    shortest: 'Shortest',
    alternative: 'Another route',
    tram: line => `Tram ${line}`,
    bus: line => `Bus ${line}`,
    taxi: 'Taxi',
    car: parking => `Car · ${parking}`,
    carDropOff: 'Car · drop-off at the destination',
  },
  places: {
    pickup: 'Pick-up point',
    dropOff: 'Drop-off point',
    carStart: 'Car',
    parking: 'Car park',
    disabledSpace: 'Disabled parking space',
    parkingNear: d => `car park ${d} from the destination`,
    disabledSpaceNear: d => `disabled parking space ${d} from the destination`,
  },
  steps: {
    go: 'Head',
    straight: 'Continue straight',
    right: 'Turn right',
    left: 'Turn left',
    back: 'Turn around',
    along: (turn, label) => `${turn}: ${label}`,
    cross: 'Cross the road',
    turnAndCross: turn => `${turn} and cross the road`,
    destination: name => `Destination: ${name}`,
    walkTo: name => `Walk to: ${name} (path unknown)`,
    foot: 'pavement or path',
    service: 'service road',
    street: 'unnamed street',
    crossing: 'road crossing',
    stairs: 'stairs',
  },
  facts: {
    stairs: (direction, steps) =>
      `${{ up: 'Stairs up', down: 'Stairs down', unknown: 'Stairs, direction unknown' }[direction]}${steps ? ` · ${steps} ${plural('en', steps, { one: 'step', other: 'steps' })}` : ''}`,
    handrail: value => `handrail: ${{ yes: 'yes', no: 'none', unknown: 'no data' }[value]}`,
    bench: 'Bench',
    benchBackrest: 'Bench with backrest',
    toilet: (name, limited) => `${limited ? 'Partly accessible toilet' : 'Accessible toilet'}${name ? ` · ${name}` : ''}`,
    entrance: 'Entrance',
    mainEntrance: 'Main entrance',
    kerbRaised: 'Raised kerb',
    kerbUnknown: 'Kerb of unknown height',
    kerbRolled: 'Rolled kerb',
    step: 'Step or obstacle',
    nodeNoWheelchair: 'Passage marked not wheelchair accessible',
    sett: d => `Cobblestones · ${d}`,
    rough: d => `Rough surface · ${d}`,
    steep: d => `Steep slope · ${d}`,
    narrow: d => `Narrow passage (< 0.9 m) · ${d}`,
    noWheelchair: d => `Not wheelchair accessible · ${d}`,
    impassable: d => `Impassable surface · ${d}`,
  },
  issues: {
    stairs: n => (n > 1 ? `Stairs on the route (${n})` : 'Stairs on the route'),
    stairsUp: 'Stairs up',
    stairsDown: 'Stairs down',
    stairsUnknown: 'Stairs of unknown direction',
    stairsNoHandrail: n => (n > 1 ? `Stairs without a handrail (${n})` : 'Stairs without a handrail'),
    stairsHandrailUnknown: n => (n > 1 ? `Stairs, handrail unknown (${n})` : 'Stairs, handrail unknown'),
    longStairs: n => (n > 1 ? `Long flights of stairs, over 15 steps (${n})` : 'Long flight of stairs, over 15 steps'),
    noBench: minute => `No bench around minute ${minute}`,
    overLimit: d => `Over your limit of ${d}`,
    kerbRaised: n => (n > 1 ? `Raised kerbs (${n})` : 'Raised kerb'),
    kerbUnknown: n => (n > 1 ? `Kerbs of unknown height (${n})` : 'Kerb of unknown height'),
    step: n => (n > 1 ? `Steps or obstacles (${n})` : 'Step or obstacle'),
    sett: d => `Cobblestones for ${d}`,
    rough: d => `Rough surface for ${d}`,
    steep: d => `Steep slope for ${d}`,
    narrow: 'Narrow passage (< 0.9 m)',
    noWheelchair: 'Section marked not wheelchair accessible',
    impassable: 'Surface marked impassable',
    tripUnknown: 'No accessibility information for this trip',
    tripNotAccessible: 'Trip marked not accessible',
    stopNotAccessible: 'Stop marked not accessible',
    noDisabledParking: d => `No car park with disabled spaces within ${d}`,
    noParking: d => `No car park within ${d}`,
    accessibleTaxi: 'Book a wheelchair-accessible vehicle',
  },
  fare: {
    basis: FARE_BASIS_EN,
  },
  errors: {
    offNetwork: 'This point is too far from the known walking network. Choose a nearby street or stop.',
    noPreferredWalk: 'There is no walking route without the stairs you are avoiding today. Showing the shortest one.',
    noBarrierFreeWalk: 'There is no barrier-free route for a wheelchair or pushchair. Showing the shortest one — check the marked spots.',
    walkFailed: 'Could not find a walking route.',
    transitFailed: 'Could not find a public transport connection.',
    transitUnavailable: 'The ZTP timetable is unavailable. Showing walking routes only.',
    noStartStop: 'No stop within walking distance of the start.',
    noEndStop: 'No stop within walking distance of the destination.',
    noService: 'No ZTP services on the selected day and time.',
    noConnection: 'No public transport connection in the next few hours.',
    roadsUnavailable: 'Road data is unavailable. Showing public transport and walking routes.',
    offRoad: 'This point is too far from a road for cars.',
    driveFailed: 'Could not find a car route.',
    badRequest: 'Check the places, date and time.',
    serverError: 'Could not prepare the journey. Please try again.',
  },
};

const de: ServerMessages = {
  distance: distance('de', { m: 'm', km: 'km' }),
  labels: {
    preferred: 'Passend für heute',
    shortest: 'Kürzeste',
    alternative: 'Andere Route',
    tram: line => `Straßenbahn ${line}`,
    bus: line => `Bus ${line}`,
    taxi: 'Taxi',
    car: parking => `Auto · ${parking}`,
    carDropOff: 'Auto · Halt am Ziel',
  },
  places: {
    pickup: 'Abholort',
    dropOff: 'Ausstiegsort',
    carStart: 'Auto',
    parking: 'Parkplatz',
    disabledSpace: 'Behindertenparkplatz',
    parkingNear: d => `Parkplatz ${d} vom Ziel`,
    disabledSpaceNear: d => `Behindertenparkplatz ${d} vom Ziel`,
  },
  steps: {
    go: 'Gehen Sie',
    straight: 'Geradeaus',
    right: 'Rechts abbiegen',
    left: 'Links abbiegen',
    back: 'Umkehren',
    along: (turn, label) => `${turn}: ${label}`,
    cross: 'Straße überqueren',
    turnAndCross: turn => `${turn} und Straße überqueren`,
    destination: name => `Ziel: ${name}`,
    walkTo: name => `Gehen Sie zu: ${name} (Wegverlauf unbekannt)`,
    foot: 'Gehweg oder Fußweg',
    service: 'Zufahrtsweg',
    street: 'Straße ohne Namen',
    crossing: 'Fußgängerüberweg',
    stairs: 'Treppe',
  },
  facts: {
    stairs: (direction, steps) =>
      `${{ up: 'Treppe aufwärts', down: 'Treppe abwärts', unknown: 'Treppe, Richtung unbekannt' }[direction]}${steps ? ` · ${steps} ${plural('de', steps, { one: 'Stufe', other: 'Stufen' })}` : ''}`,
    handrail: value => `Handlauf: ${{ yes: 'vorhanden', no: 'keiner', unknown: 'keine Angaben' }[value]}`,
    bench: 'Sitzbank',
    benchBackrest: 'Sitzbank mit Rückenlehne',
    toilet: (name, limited) => `${limited ? 'Eingeschränkt barrierefreie Toilette' : 'Barrierefreie Toilette'}${name ? ` · ${name}` : ''}`,
    entrance: 'Eingang',
    mainEntrance: 'Haupteingang',
    kerbRaised: 'Hoher Bordstein',
    kerbUnknown: 'Bordstein unbekannter Höhe',
    kerbRolled: 'Schräger Bordstein',
    step: 'Stufe oder Hindernis',
    nodeNoWheelchair: 'Durchgang als nicht rollstuhlgerecht markiert',
    sett: d => `Kopfsteinpflaster · ${d}`,
    rough: d => `Unebener Belag · ${d}`,
    steep: d => `Starke Steigung · ${d}`,
    narrow: d => `Enger Durchgang (< 0,9 m) · ${d}`,
    noWheelchair: d => `Nicht rollstuhlgerecht · ${d}`,
    impassable: d => `Unpassierbarer Belag · ${d}`,
  },
  issues: {
    stairs: n => (n > 1 ? `Treppen auf der Route (${n})` : 'Treppe auf der Route'),
    stairsUp: 'Treppe aufwärts',
    stairsDown: 'Treppe abwärts',
    stairsUnknown: 'Treppe mit unbekannter Richtung',
    stairsNoHandrail: n => (n > 1 ? `Treppen ohne Handlauf (${n})` : 'Treppe ohne Handlauf'),
    stairsHandrailUnknown: n => (n > 1 ? `Treppen ohne Angaben zum Handlauf (${n})` : 'Treppe ohne Angaben zum Handlauf'),
    longStairs: n => (n > 1 ? `Lange Treppen, über 15 Stufen (${n})` : 'Lange Treppe, über 15 Stufen'),
    noBench: minute => `Keine Sitzbank um Minute ${minute}`,
    overLimit: d => `Über Ihrem Limit von ${d}`,
    kerbRaised: n => (n > 1 ? `Hohe Bordsteine (${n})` : 'Hoher Bordstein'),
    kerbUnknown: n => (n > 1 ? `Bordsteine unbekannter Höhe (${n})` : 'Bordstein unbekannter Höhe'),
    step: n => (n > 1 ? `Stufen oder Hindernisse (${n})` : 'Stufe oder Hindernis'),
    sett: d => `Kopfsteinpflaster auf ${d}`,
    rough: d => `Unebener Belag auf ${d}`,
    steep: d => `Starke Steigung auf ${d}`,
    narrow: 'Enger Durchgang (< 0,9 m)',
    noWheelchair: 'Abschnitt als nicht rollstuhlgerecht markiert',
    impassable: 'Belag als unpassierbar markiert',
    tripUnknown: 'Keine Angaben zur Barrierefreiheit dieser Fahrt',
    tripNotAccessible: 'Fahrt als nicht barrierefrei markiert',
    stopNotAccessible: 'Haltestelle als nicht barrierefrei markiert',
    noDisabledParking: d => `Kein Parkplatz mit Behindertenstellplätzen im Umkreis von ${d}`,
    noParking: d => `Kein Parkplatz im Umkreis von ${d}`,
    accessibleTaxi: 'Bestellen Sie ein rollstuhlgerechtes Fahrzeug',
  },
  fare: {
    basis: FARE_BASIS_DE,
  },
  errors: {
    offNetwork: 'Der Punkt liegt zu weit vom bekannten Fußwegenetz entfernt. Wählen Sie eine nahe Straße oder Haltestelle.',
    noPreferredWalk: 'Es gibt keinen Fußweg ohne die Treppen, die Sie heute meiden. Wir zeigen den kürzesten.',
    noBarrierFreeWalk: 'Es gibt keine barrierefreie Route für Rollstuhl oder Kinderwagen. Wir zeigen die kürzeste – prüfen Sie die markierten Stellen.',
    walkFailed: 'Der Fußweg konnte nicht berechnet werden.',
    transitFailed: 'Die ÖPNV-Verbindung konnte nicht berechnet werden.',
    transitUnavailable: 'Der ZTP-Fahrplan ist nicht verfügbar. Wir zeigen nur Fußwege.',
    noStartStop: 'Keine Haltestelle in Gehweite vom Start.',
    noEndStop: 'Keine Haltestelle in Gehweite vom Ziel.',
    noService: 'Keine ZTP-Fahrten am gewählten Tag zur gewählten Uhrzeit.',
    noConnection: 'Keine ÖPNV-Verbindung in den nächsten Stunden.',
    roadsUnavailable: 'Straßendaten sind nicht verfügbar. Wir zeigen ÖPNV und Fußwege.',
    offRoad: 'Der Punkt liegt zu weit von einer befahrbaren Straße entfernt.',
    driveFailed: 'Die Autoroute konnte nicht berechnet werden.',
    badRequest: 'Prüfen Sie Orte, Datum und Uhrzeit.',
    serverError: 'Die Reise konnte nicht vorbereitet werden. Bitte versuchen Sie es erneut.',
  },
};

const messages: Record<Locale, ServerMessages> = { pl, en, de };

export function serverMessages(locale: unknown = defaultLocale): ServerMessages {
  return messages[isLocale(locale) ? locale : defaultLocale];
}
