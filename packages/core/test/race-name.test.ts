import { describe, expect, it } from 'vitest';
import { formatFecName } from '../src/races/name';

/** Real-looking FEC CAND_NAME values (the shapes seen in the 2026 candidate master). */
describe('formatFecName', () => {
  it.each([
    ['ARRINGTON, JODEY', 'Jodey Arrington'],
    ['HARVEY-HALL, PHYLLIS', 'Phyllis Harvey-Hall'],
    ['BARR, GARLAND ANDY', 'Garland Andy Barr'],
    ['SULLIVAN, DAN', 'Dan Sullivan'],
    ['OMAR, ILHAN', 'Ilhan Omar'],
  ])('orders and cases plain names: %s', (filed, shown) => {
    expect(formatFecName(filed)).toBe(shown);
  });

  it.each([
    ['MCCORMICK, RICHARD DEAN DR.', 'Dr. Richard Dean McCormick'],
    ['MCBRIDE, SARAH ELIZABETH', 'Sarah Elizabeth McBride'],
    ['MCALMOND, RUSSELL', 'Russell McAlmond'],
    ['MCDONALD RIVET, KRISTEN', 'Kristen McDonald Rivet'],
    ['MACDONALD, JANE', 'Jane MacDonald'],
    ['MACKENZIE, LEE', 'Lee MacKenzie'],
    ['MACE, NANCY', 'Nancy Mace'],
    ['MACHADO, ANA', 'Ana Machado'],
    ['MACAULAY, KODY CRAIG', 'Kody Craig Macaulay'],
  ])('handles Mc and Mac: %s', (filed, shown) => {
    expect(formatFecName(filed)).toBe(shown);
  });

  it.each([
    ["O'DONNELL, MARTY", "Marty O'Donnell"],
    ["D'ARRIGO, TONY C", "Tony C. D'Arrigo"],
    ["BIVINGS, MARTELL DE'ANGELO", "Martell De'Angelo Bivings"],
    ['MCBRIDE, JOHN-PAUL', 'John-Paul McBride'],
    ['WIEDENFELD-NEEDHAM, BORIS', 'Boris Wiedenfeld-Needham'],
    ['O’BRIEN, KELLY', 'Kelly O’Brien'],
  ])('handles apostrophes and hyphens: %s', (filed, shown) => {
    expect(formatFecName(filed)).toBe(shown);
  });

  it.each([
    ['CARL, JERRY LEE, JR', 'Jerry Lee Carl Jr.'],
    ['BEGICH, NICHOLAS III', 'Nicholas Begich III'],
    ['PFLUGER, AUGUST LEE II', 'August Lee Pfluger II'],
    ['CARTER, TROY A. SR.', 'Troy A. Carter Sr.'],
    ['HATFIELD JR, SCOTT ALLEN', 'Scott Allen Hatfield Jr.'],
    ['WHALEN III, JOHN J', 'John J. Whalen III'],
    ['WILLIAMS, III, PERTIS HERMAN', 'Pertis Herman Williams III'],
    ['LEVI, ERSKINE LINCOLN MR JR', 'Erskine Lincoln Levi Jr.'],
    ['SMITH, JOHN V', 'John V. Smith'],
  ])('moves generational suffixes after the name: %s', (filed, shown) => {
    expect(formatFecName(filed)).toBe(shown);
  });

  it.each([
    ['VAN DREW, JEFF MR', 'Jeff Van Drew'],
    ['CUNNINGHAM, WILLIAM ROBERT MR. JR.', 'William Robert Cunningham Jr.'],
    ['BURLEY, BRIAN J MR.', 'Brian J. Burley'],
    ['RYANS, JERLILIA MS.', 'Jerlilia Ryans'],
    ['WOMACK, STEPHEN A THE HON', 'Stephen A. Womack'],
    ['DESJARLAIS, SCOTT HON.', 'Scott Desjarlais'],
    ['GOSAR, PAUL DR.', 'Dr. Paul Gosar'],
    ['SMITH, PAT REV', 'Rev. Pat Smith'],
    ['CHALIFOUX, THOMAS E. COLONEL JR.', 'Colonel Thomas E. Chalifoux Jr.'],
    ['WENDELIN, STEVEN COMMANDER USN, (RET)', 'Commander Steven Wendelin USN (Ret.)'],
    ['DUNN, NEAL PATRICK MD, FACS', 'Neal Patrick Dunn MD FACS'],
    ['RAZACK, MD JD, NIZAM', 'Nizam Razack MD JD'],
  ])('drops courtesy honorifics, keeps titles and credentials: %s', (filed, shown) => {
    expect(formatFecName(filed)).toBe(shown);
  });

  it.each([
    ['HOFFMAN, FRANCIS X "FRANK"', 'Francis X. "Frank" Hoffman'],
    ['MAIDMENT, EDWARD A. (ANDY)', 'Edward A. (Andy) Maidment'],
    ["BALINT, REBECCA 'BECCA'", "Rebecca 'Becca' Balint"],
    ['MONTANEZ BERRIOS (DMB), DELIRIS', 'Deliris Montanez Berrios (DMB)'],
    ['FORD, JAMES (J.D.) DAVID', 'James (J.D.) David Ford'],
    ['HOLNESS, DALE V.C. MR.', 'Dale V.C. Holness'],
  ])('keeps nicknames and initialisms: %s', (filed, shown) => {
    expect(formatFecName(filed)).toBe(shown);
  });

  it('removes phone numbers typed into the name field', () => {
    expect(formatFecName('BRITVEC, KEL JACOBS 2395601987')).toBe('Kel Jacobs Britvec');
    expect(formatFecName('MCBRIDE, JOHN-PAUL 2183436597')).toBe('John-Paul McBride');
  });

  it('tolerates stray commas, missing commas and empty names', () => {
    expect(formatFecName('BRINK,, BRIDGET')).toBe('Bridget Brink');
    expect(formatFecName('FIERRO, MARTHA ELENA,')).toBe('Martha Elena Fierro');
    expect(formatFecName('JOHN ARMENIAN')).toBe('John Armenian');
    expect(formatFecName('MADONNA')).toBe('Madonna');
    expect(formatFecName('  SMITH,   ')).toBe('Smith');
    expect(formatFecName('')).toBe('');
  });

  it('does not change a name that is already readable', () => {
    expect(formatFecName('Jodey Arrington')).toBe('Jodey Arrington');
  });
});
