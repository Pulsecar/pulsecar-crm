// Прайс работ (Cennik usług) из Motowarsztat: 450 позиций в 10 категориях (цены там не заданы, кроме «Felga z czujnikiem»)
const C = ['Dopłata za rodzaj felgi', 'Serwis Klimatyzacji', 'Przegląd Pojazdu', 'Serwis Opon', 'Auta 4x4', 'Elektryka', 'Klimatyzacja', 'Mechanika pojazdowa', 'Elektronika samochodowa', 'Układy wydechowe'];
const RAW = `0|Felga z czujnikiem|20
1|Demontaż chłodnicy klimatyzacji
1|Demontaż kompresora klimatyzacji
1|Demontaż przewodów klimatyzacji
1|Diagnostyka przewodów klimatyzacji
1|Kontrola ilości czynnika chłodzącego i oleju
1|Montaż chłodicy klimatyzacji
1|Montaż kompresora klimatyzacji
1|Montaż przewodów klimatyzacji
1|Napełnienie klimatyzacji
1|Napełnienie klimatyzacji - nowy czynnik (typ czynnika)
1|Napełnienie klimatyzacji - stary czynnik (typ czynnia
1|Napełnienie układu azotem
1|Napełnienie układu azotem z barwnikiem
1|Napełnienie układu gazem z barwnikiem
1|Odgrzybianie klimatyzacji
1|Odgrzybianie klimatyzacji ozonem
1|Osuszanie układu klimatyzacji
1|Ozonowanie pojazdu
1|Serwis klimatyzacji R1234YF
1|Serwis klimatyzacji R134A
1|Serwis klimatyzacji samochodowej
1|Spawanie przewodów klimatyzacji
1|Sprawdzenie szczelności układu
1|Szukanie źródła nieszczelności
1|Uzupełnienie oleju i czynnika chłodzącego R1234yf według norm producenta
1|Uzupełnienie oleju i czynnika chłodzącego R134a według norm producenta
1|Wymiana filtra kabinowego
1|Wymiana filtra powietrza
2|Badanie powłoki lakierniczej oraz daty produkcji na pasach bezpieczeństwa
2|Diagnostyka komputerowa samochodu
2|Kontrola kondycji ogumienia
2|Kontrola luzów zawieszenia i układu kierowniczego
2|Kontrola stanu szyb, wycieraczek i dyszy spryskiwaczy
2|Kontrola temperatury zamarzania płynu chłodniczego
2|Kontrola zużycia płynów eksploatacyjnych (płynu hamulcowego, chłodniczego oraz wspomagania układu kierowniczego)
2|Podłączenie nowego akumulator
2|Podpięcie komputera diagnostycznego i odczytanie błędów
2|Przegląd klimatyzacji
2|Przegląd podstawowy
2|Przegląd przed wakacjami
2|Przegląd rozszerzony
2|Przegląd samochodu przed zakupem
2|Przegląd zimowy
2|Sprawdzenie działania automatycznej skrzyni biegów
2|Sprawdzenie prawidłowego działania wyposażenia auta, w tym klimatyzacji
2|Sprawdzenie silnika i układu napędowego pod kątem wycieków
2|Sprawdzenie stanu akumulatora
2|Sprawdzenie stanu tarcz i klocków hamulcowych oraz przewodów
2|Sprawdzenie zgodności numeru VIN w dokumentach z tymi na aucie
2|Test wtyskiwaczy przelewowy
2|Wyjęcie starego akumulator
3|Czyszczenie opony
3|Demontaż czujników TPMS
3|Demontaż opon na aluminiowych felgach 16-calowych lub mniejszych
3|Demontaż opon na aluminiowych felgach 17-calowychh
3|Demontaż opon na aluminiowych felgach 18-calowych
3|Demontaż opon na aluminiowych felgach 19-calowych
3|Demontaż opon na aluminiowych felgach 20-calowych lub większych
3|Demontaż opon na stalowych felgach
3|Demontaż opon typu run flat na aluminiowych felgach 17"
3|Demontaż opon typu run flat na aluminiowych felgach 20" lub więcj
3|Demontaż opon typu run flat na aluminiowych felgach do 16"
3|Demontaż opon typu run flat na aluminiowych felgach do 18"
3|Demontaż opon typu run flat na aluminiowych felgach do 19"
3|Instalacja systemu TPMS
3|Kalibracja czujników TPMS
3|Lokalizacja pęknięcia opony
3|Lokalizacja przebicia opony
3|Montaż czujników TPMS
3|Montaż kół na samochodzie - felga stalowa
3|Montaż opon na aluminiowych felgach 16-calowych lub mniejszych
3|Montaż opon na aluminiowych felgach 17"
3|Montaż opon na aluminiowych felgach 18"
3|Montaż opon na aluminiowych felgach 19"
3|Montaż opon na aluminiowych felgach 20" lub większych
3|Montaż opon na stalowych felgach 16-calowych lub mniejszych
3|Montaż opon na stalowych felgach 17"
3|Montaż opon na stalowych felgach 18"
3|Montaż opon na stalowych felgach 19"
3|Montaż opon na stalowych felgach 20" lub większych
3|Montaż opon typu run flat na aluminiowych felgach 17"
3|Montaż opon typu run flat na aluminiowych felgach do 16"
3|Montaż opon typu run flat na aluminiowych felgach do 18"
3|Montaż opon typu run flat na aluminiowych felgach do 19"
3|Montaż opon typu run flat na aluminiowych felgach do 20" lub więcej
3|Montaż/demontaż opon i felg Off Road
3|Napełnienie opon azotem
3|Naprawa czyjników TPMS
3|Naprawa Felg
3|Naprawa opony ciężarowej
3|Naprawa opony na gorąco
3|Naprawa opony na zimno
3|Naprawa opony rolniczej
3|Naprawa opony zgodnie z procedurą technoligi naprawy
3|Odblokowanie w oprogramowaniu czujników TPMS
3|Odczyt pamięci sterownika TPMS
3|Przełożenie kół - felga aluminiowa 17"
3|Przełożenie kół - felga aluminiowa 20" lub więcej
3|Przełożenie kół - felga aluminiowa do 16"
3|Przełożenie kół - felga aluminiowa do 18"
3|Przełożenie kół - felga aluminiowa do 19"
3|Przełożenie kół - felga stalowa 17"
3|Przełożenie kół - felga stalowa 18" lub więcej
3|Przełożenie kół - felga stalowa do 16"
3|Regeneracj Felg
3|Sprawdzanie stanu zaworów
3|Test czujników TPMS
3|Wgranie oprograowania TPMS
3|Wymiana czujników TPMS
3|Wymiana opon do "zakresy rozmiaru felg" - felga alumiowa
3|Wymiana opon do "zakresy rozmiaru felg" - felga stalowa
3|Wymiana opon typu Runflat
3|Wyważanie kół - felga stalowa
3|Założenie nowego kompletu ogumienia na felgi - felga stalowa
4|Budowa i Obsługa pojazdów rajdowych
4|Demontaż/Montaż Paki
4|Dodatkowa Zabudowa Pojazdu
4|Modernizacja Silnika Mechaniczna
4|Modernizacja Silnika Programowa
4|Modernizacja: Inne układy
4|Modernizacja: Klatki Bezpieczeństwa
4|Modernizacja: Orurowanie Pojazdu
4|Modernizacja: Oświetlenie
4|Modernizacja: Progi
4|Modernizacja: Układy wydechowe
4|Modernizacja: Zawieszenie
4|Modernizacja: Zderzaki
4|Montaż Wyciągarek
4|Naprawa Ramy
4|Oklejanie Auta do Rajdów
4|Przegląd po Rajdach
4|Przeglądy aut przed- i powyprawowe
4|Przygotowanie Pojazdu do Rajdów
4|Serwis Rajdowy
4|Śrutowanie Elementów
4|Zabezpieczenie Antykorozyjne
5|Aktualizacja oprogramowania
5|Diagnostyka baterii HV
5|Diagnostyka silnika elektrycznego
5|Diagnostyka silników hybrydowych
5|Inicjalizacja czujnika prądu akumulatora HV
5|Kodowanie kodów wtrysków
5|Kodowanie Stacyjki/Kluczyka
5|Kontrola klem akumulatora z ewentualnym czyszczeniem
5|Naprawa Alternatorów 48V
5|Naprawa Alternatorów Hybrydowych
5|Naprawa Baterii Hybrydowych
5|Naprawa BCM, BCU (Chysler, Jeep, inne)
5|Naprawa BSI (Citroe, Peugeot, Fiat)
5|Naprawa CEM (Volvo)
5|Naprawa CIM (Opel)
5|Naprawa Immobilizerów
5|Naprawa komuterów ABS/ESP/ECS
5|Naprawa Licznika
5|Naprawa Modułu Komfortu
5|Naprawa przekladni hybrydowej
5|Naprawa Stacyjki
5|Naprawa Sterowika Skrzyni Biegów
5|Naprawa strowników SAM (Mercedes)
5|Naprawa UCH (Ranault)
5|Regeneracja Alternatorów 48V
5|Regeneracja Alternatorów Hybrydowych
5|Regeneracja Baterii Hybrydowych HV
5|Regeneracja Baterii Samochodów Elektrycznych
5|Regeneracja Falownika Hybrydowego
5|Regeneracja filtra cząstek stałych
5|Regeneracja Invertera Convertera
5|Regeneracja Pompy Klimatyzacji Hybrydowych
5|Regeneracja Przetwornicy DC/DC
5|Sprawdzanie paramtrów czujników
5|Sprawdzenie stanu elektrolitu
5|Uzupełnienie elektrolitu
5|Wymiana Baterii HV
5|Wymiana Baterii Hybrydowej
5|Wymiana bezpieczników
5|Wymiana czujników
5|Wymiana głośników
5|Wymiana radia
5|Wymiana żarówek
5|Montaż czujników odległości
5|Montaż elektrycznego ogrzewania postojowego DEFA
5|Montaż kamery cofania
5|Montaż siłowników centralnego zamka
5|Montaż spalinowego ogrzewania postojowego typu Webasto
5|Naprawa i wymiana zamków
5|Naprawa modułu zapłonowego
5|Naprawa rozdzielacza
5|Sprawdzenie ładowania akumulatora
5|Test obciążeniowy akumulatora
5|Ustawienie świateł
5|Wymiana akumulatora
5|Wymiana alternatora
5|Wymiana cewki zapłonowej
5|Wymiana cięgna wycieraczki
5|Wymiana kopułki rozdzielacza
5|Wymiana mechanizmu podnoszenia szyby
5|Wymiana nagrzewnicy silnika
5|Wymiana pompy spryskiwacza
5|Wymiana przerywnika kierunkowskazów
5|Wymiana przewodów zapłonowych
5|Wymiana rozrusznika
5|Wymiana silniczka wycieraczek
5|Wymiana silnika regulacji wysokości świateł
5|Wymiana stacyjki
5|Wymiana świec zapłonowych/żarowych
5|Wymiana zegarów deski rozdzielczej
5|Wymiana żarówki klosza (Tył)
5|Wymiana żarówki ksenonowej
5|Wymiana żarówki reflektora (Przód)
5|Wymiana żarówki tablicy rejestracyjnej
6|Dezynfekcja klimatyzacji
6|Kontrola ilości czynnika chłodzącego i oleju
6|Montaż nowego filtra lub filtrów
6|Napełnienie układu azotem lub innym gazem z barwnikiem
6|Ozonowanie klimatyzacj
6|Sprawdzenie szczelności układu
6|Szukanie źródła nieszczelności
6|Uzupełnienie oleju i czynnika chłodzącego R134a według norm producenta
6|Wyjęcie zużytego filtra lub filtrów kabinowyc
6|Wyjęcie zużytego filtra lub filtrów Powietrza
7|Czyszczenie układu paliwowego
7|Diagnostyka zawieszenia
7|Diagnoza
7|Generalny remont silnika
7|Kasowanie inspekcji serwisowej
7|Kasowanie kodów błędów w samochodzie
7|Montaż bagażnika dachowego
7|Montaż belek dachowych
7|Montaż boxu dachowego
7|Montaż haka holowniczego
7|Naprawa ABS
7|Naprawa hamulców bębnowych
7|Naprawa silnika
7|Naprawa układu chłodzenia
7|Naprawa układu dolotowego
7|Naprawa układu hamulcowego
7|Naprawa układu kierowniczego
7|Naprawa układu napędowego
7|Naprawa układu paliwowego
7|Naprawa układu wydechowego
7|Naprawa wałów i mostów napędowych
7|Naprawa wentylatora chłodnicy
7|Naprawa wieszaków tłumika
7|Naprawa wtryskiwacza paliwa
7|Naprawa zawieszenia
7|Planowanie głowicy
7|Regeneracja filtra cząstek stałych DPF / FAP
7|Spawanie tłumika
7|Ustawienie geometrii i zbieżności kół
7|Uszczelnianie wydechu
7|Weryfikacja silnika
7|Weryfikacja układu chłodzenia
7|Weryfikacja układu hamulcowego
7|Weryfikacja układu kierowniczego
7|Weryfikacja układu napędowego
7|Weryfikacja układu paliwowego
7|Weryfikacja układu wydechowego
7|Wymiana amortyzatora
7|Wymiana amortyzatora oś przednia
7|Wymiana amortyzatora oś tylna
7|Wymiana amortyzatora przód mcpherson
7|Wymiana belki oś tylna
7|Wymiana bębnów hamulcowych
7|Wymiana chłodnicy silnika
7|Wymiana cylinderków hamulcowych w samochodzie
7|Wymiana czujnika / termowłącznika wentylatora
7|Wymiana czujnika ABS
7|Wymiana czujnika temperatury
7|Wymiana docisku sprzęgła
7|Wymiana drążka kierowniczego
7|Wymiana filtra DPF
7|Wymiana filtra kabinowego
7|Wymiana filtra paliwa
7|Wymiana filtra powietrza
7|Wymiana gum stabilizatora
7|Wymiana katalizatora
7|Wymiana klocków hamulcowych
7|Wymiana klocków hamulcowych (Przód)
7|Wymiana klocków hamulcowych tył
7|Wymiana kolektora dolotowego
7|Wymiana kolektora wydechowego
7|Wymiana kolumny McPhersona
7|Wymiana koła pasowego
7|Wymiana koła zamachowego
7|Wymiana kompletnego sprzęgła z dwumasowym kołem zamachowym
7|Wymiana kompletnego tłumika
7|Wymiana końcówki drążka kierowniczego
7|Wymiana krzyżaka kolumny kierowniczej
7|Wymiana linki gazu
7|Wymiana linki hamulca ręcznego
7|Wymiana linki sprzęgła
7|Wymiana łańcucha rozrządu
7|Wymiana łącznika stabilizatora
7|Wymiana łączników stabilizatora
7|Wymiana łożyska amortyzatora
7|Wymiana łożyska koła
7|Wymiana łożyska oporowego sprzęgła
7|Wymiana łożyska w kole
7|Wymiana maglownicy
7|Wymiana nagrzewnicy
7|Wymiana napinacza paska klinowego
7|Wymiana oleju i filtra hydraulicznego w skrzyni automatycznej
7|Wymiana oleju i filtra oleju
7|Wymiana oleju i filtra w skrzyni manualnej
7|Wymiana oleju w mechanizmie różnicowym
7|Wymiana oleju w skrzyni automatycznej
7|Wymiana osłony elastycznej amortyzatora
7|Wymiana osłony elastycznej przekładni kierowniczej
7|Wymiana osłony przegubu
7|Wymiana panewek
7|Wymiana panewek korbowodowych
7|Wymiana pasa bezpieczeństwa
7|Wymiana paska rozrządu
7|Wymiana paska wielorowkowego
7|Wymiana piasty
7|Wymiana pierścieni tłokowych
7|Wymiana piór wycieraczek
7|Wymiana płynu chłodniczego
7|Wymiana płynu hamulcowego
7|Wymiana płynu wspomagania kierownicy
7|Wymiana poduszki amortyzatora
7|Wymiana pompowtryskiwaczy
7|Wymiana pompy ABS
7|Wymiana pompy hamulcowej
7|Wymiana pompy paliwa
7|Wymiana pompy sprzęgła
7|Wymiana pompy wody
7|Wymiana pompy wspomagania
7|Wymiana pompy wtryskowej
7|Wymiana półosi
7|Wymiana przegubu
7|Wymiana przekładni kierowniczej
7|Wymiana przepływomierza - czujnika masy powietrza
7|Wymiana przewodów hamulcowych elastycznych
7|Wymiana przewodów hamulcowych metalowych
7|Wymiana przewodów paliwowych
7|Wymiana przewodów układu chłodzenia w samochodzie
7|Wymiana przewodu dolotowego
7|Wymiana rezystora nagrzewnicy
7|Wymiana rolki napinacza
7|Wymiana rolki napinającej
7|Wymiana rozpieraczy
7|Wymiana rozrządu
7|Wymiana silentblocku wahacza
7|Wymiana silnika regulacji biegu jałowego
7|Wymiana sondy lambda
7|Wymiana sprężyn zawieszenia
7|Wymiana sprzęgła
7|Wymiana sprzęgła wentylatora chłodnicy (wiskozy)
7|Wymiana stabilizatora
7|Wymiana sworznia tłokowego
7|Wymiana sworznia wahacza
7|Wymiana szczęk hamulcowych
7|Wymiana tarcz hamulcowych
7|Wymiana tarcz hamulcowych (Przód)
7|Wymiana tarcz hamulcowych (Tył)
7|Wymiana tarcz kotwicznych bębnów hamulcowych
7|Wymiana tarczy sprzęgła
7|Wymiana teleskopu pokrywy silnika lub klapy bagażnika
7|Wymiana termostatu
7|Wymiana tłoków
7|Wymiana tłumika drgań
7|Wymiana tłumika końcowego
7|Wymiana tłumika środkowego
7|Wymiana tulei wahacza
7|Wymiana tulejek gumy stabilizatora
7|Wymiana turbosprężarki
7|Wymiana uszczelki kolektora dolotowego
7|Wymiana uszczelki kolektora wydechowego
7|Wymiana uszczelki miski olejowej
7|Wymiana uszczelki pod głowicą
7|Wymiana uszczelki pokrywy zaworów
7|Wymiana uszczelki przewodu dolotowego
7|Wymiana uszczelniacza półosi napędowej
7|Wymiana uszczelniaczy zaworowych
7|Wymiana wahacza
7|Wymiana wałka rozrządu
7|Wymiana wału korbowego
7|Wymiana wtryskiwaczy
7|Wymiana wysprzęglika
7|Wymiana zaworów
7|Wymiana zaworu EGR
7|Wymiana zbiornika paliwa
7|Wymiana zwrotnicy koła
8|Weryfikacja instalacji elektrycznej
8|Wymiana czujnika biegu jałowego
8|Wymiana czujnika ciśnienia gazu (LPG)
8|Wymiana czujnika ciśnienia modułu tłoczącego DeNOx
8|Wymiana czujnika ciśnienia oleju
8|Wymiana czujnika ciśnienia paliwa
8|Wymiana czujnika ciśnienia powietrza w kole TPMS
8|Wymiana czujnika ciśnienia spalin
8|Wymiana czujnika ciśnienia w kolektorze ssącym
8|Wymiana czujnika ciśnienia w układzie hamulcowym
8|Wymiana czujnika Halla aparatu zapłonowego i wału korbowego
8|Wymiana czujnika i nadajnika układu sterowania wtryskiem paliwa
8|Wymiana czujnika impulsów / impulsatora
8|Wymiana czujnika klimatyzacji
8|Wymiana czujnika nachylenia, układu alarmowego
8|Wymiana czujnika obrotomierza
8|Wymiana czujnika oleju
8|Wymiana czujnika otwierania drzwi
8|Wymiana czujnika położenia pedału gazu
8|Wymiana czujnika położenia pedału sprzęgła
8|Wymiana czujnika położenia przepustnicy
8|Wymiana czujnika położenia wałka rozrządu
8|Wymiana czujnika położenia wału korbowego
8|Wymiana czujnika poziomu oleju silnikowego
8|Wymiana czujnika poziomu paliwa
8|Wymiana czujnika poziomu płynu chłodzącego
8|Wymiana czujnika poziomu płynu hamulcowego
8|Wymiana czujnika poziomu płynu spryskiwacza
8|Wymiana czujnika poziomu zawieszenia pneumatycznego
8|Wymiana czujnika przesunięcia pedału hamulca
8|Wymiana czujnika skrętu koła kierownicy
8|Wymiana czujnika skrzyni biegów
8|Wymiana czujnika spalania stukowego
8|Wymiana czujnika szybkości
8|Wymiana czujnika świateł stop
8|Wymiana czujnika temperatury oleju
8|Wymiana czujnika temperatury paliwa
8|Wymiana czujnika temperatury płynu chłodzącego
8|Wymiana czujnika temperatury powietrza wlotowego
8|Wymiana czujnika temperatury spalin
8|Wymiana czujnika temperatury wewnętrznej klimatyzacji
8|Wymiana czujnika temperatury zewnętrznej
8|Wymiana czujnika tlenków azotu NOx
8|Wymiana czujnika układu chłodzenia
8|Wymiana czujnika zużycia klocka hamulcowego
8|Wymiana czujnika/przekaźnika
9|Naprawa katalizatora
9|Naprawa kolektora wydechowego
9|Naprawa sondy lambda
9|Naprawa tłumika drgań
9|Naprawa wieszaka układu wydechowego
9|Spawanie miejscowe skorodowanych części
9|Sprawdzenie stanu wieszaków elastycznych i ich ewentualna wymiana
9|Sprawdzenie szczelności układu i lokalizacja ewentualnych uszkodzeń
9|Uszczelnienie połączeń między poszczególnymi elementami
9|Wymiana katalizatora
9|Wymiana kolektora wydechowego
9|Wymiana sondy lambda
9|Wymiana tłumika drgań
9|Wymiana tłumika końcowego
9|Wymiana tłumika środkowego
9|Wymiana wieszaka układu wydechowego`;

/** [категория, название, цена] без повторов */
export const MW_SERVICES = (() => {
  const seen = new Set();
  const out = [];
  for (const line of RAW.split('\n')) {
    const [ci, name, price] = line.split('|');
    const key = ci + '|' + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([C[Number(ci)], name.trim(), Number(price) || 0]);
  }
  return out;
})();

/** Шаблон «Wulkanizacja» из Motowarsztat: группы работ для быстрого заказа */
export const MW_WHEEL_GROUPS = ['Rozmiar', 'Dopłata za rodzaj felgi', 'Dopłata za rodzaj samochodu'];
