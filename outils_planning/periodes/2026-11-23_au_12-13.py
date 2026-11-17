import datetime as dt
TITLE = 'CEDIF Saint-Antoine — Planning du 23 novembre au 13 décembre 2026'
EMP = ['Yassine', 'Rose', 'Jennyfer', 'Sara', 'Emma']
CONTRAT = {'Yassine': 35, 'Rose': 35, 'Jennyfer': 25, 'Sara': 15, 'Emma': 20}

OUV7 = [('09:50', '14:00'), ('15:00', '17:50')]       # 7h00 ouverture
JF = [('12:25', '15:00'), ('16:00', '19:40')]         # 6h15 fermeture Jennyfer
YMID = [('11:00', '14:00'), ('15:00', '19:00')]       # 7h00 milieu de journée (Yassine)
YFER = [('11:40', '15:00'), ('16:00', '19:40')]       # 7h00 fermeture (Yassine)
SAT_SARA = [('09:50', '14:00'), ('15:00', '18:30')]   # 7h40 ouverture samedi
SAT_SARA_MID = [('10:30', '14:30'), ('15:30', '19:10')]  # 7h40 samedi quand Rose ouvre
SUN_SARA = [('10:50', '14:00'), ('15:00', '19:10')]   # 7h20 dimanche
SUN_ROSE = [('10:50', '14:00'), ('15:00', '18:50')]   # 7h00 dimanche ouverture (part avant la fermeture)
SUN_Y = [('11:10', '15:00'), ('16:00', '19:10')]      # 7h00 dimanche
E_OUV = [('09:50', '14:00'), ('15:00', '17:30')]      # 6h40 Emma ouverture
E_MID = [('11:00', '14:00'), ('15:00', '18:40')]      # 6h40 Emma milieu de journée
E_SUN = [('12:00', '15:30'), ('16:00', '19:10')]      # 6h40 Emma dimanche (fermeture)
E_FER = [('12:00', '15:00'), ('16:00', '19:40')]      # 6h40 Emma fermeture
SUN_J = [('11:55', '15:00'), ('16:00', '19:10')]      # 6h15 Jennyfer dimanche

OUV8 = [('09:50', '14:00'), ('15:00', '18:50')]       # 8h00 ouverture longue (Rose)
ROSE_LATE = [('12:00', '15:00'), ('16:00', '19:00')]  # 6h00 Rose commence à midi, part avant la fermeture

# Période des fêtes : 3 personnes du jeudi au dimanche. Mardi : Rose + Yassine ouvrent ensemble (commande).
# Rose en ouverture du lundi au vendredi sauf un jour où elle commence à 12h (Emma ouvre ce jour-là).
# Yassine tous les dimanches. Jennyfer toujours en fermeture, 1 dimanche par mois maximum.
W1 = [  # 23 -> 29 novembre (Emma indispo ven 27)
 {'Rose': OUV8, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': OUV7, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YFER},
 {'Emma': E_OUV, 'Rose': ROSE_LATE, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF, 'Emma': ('INDISPONIBLE', 0)},
 {'Sara': SAT_SARA, 'Emma': E_MID, 'Yassine': YFER},
 {'Sara': SUN_SARA, 'Yassine': SUN_Y, 'Emma': E_SUN},
]
W2 = [  # 30 novembre -> 6 décembre (Emma indispo mer 2 matin ; Jennyfer indispo dim 6)
 {'Rose': OUV8, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': OUV7, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YFER, 'Emma': ('INDISPONIBLE (matin)', 0)},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF},
 {'Emma': E_OUV, 'Rose': ROSE_LATE, 'Jennyfer': JF},
 {'Sara': SAT_SARA, 'Emma': E_MID, 'Yassine': YFER},
 {'Sara': SUN_SARA, 'Yassine': SUN_Y, 'Emma': E_SUN, 'Jennyfer': ('INDISPONIBLE', 0)},
]
W3 = [  # 7 -> 13 décembre (Jennyfer indispo lun 7 ; Emma indispo ven 11, sam 12, dim 13)
 {'Rose': OUV8, 'Emma': E_FER, 'Jennyfer': ('INDISPONIBLE', 0)},
 {'Rose': OUV7, 'Yassine': OUV7, 'Emma': E_FER},
 {'Rose': OUV7, 'Yassine': YFER},
 {'Emma': E_OUV, 'Rose': ROSE_LATE, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF, 'Emma': ('INDISPONIBLE', 0)},
 {'Sara': SAT_SARA, 'Yassine': YMID, 'Jennyfer': JF, 'Emma': ('INDISPONIBLE', 0)},
 {'Sara': SUN_SARA, 'Yassine': SUN_Y, 'Jennyfer': SUN_J, 'Emma': ('INDISPONIBLE', 0)},
]
WEEKS = [(dt.date(2026, 11, 23), W1), (dt.date(2026, 11, 30), W2), (dt.date(2026, 12, 7), W3)]
NOTES = [
 "• Période des fêtes : 3 personnes du jeudi au dimanche ; mardi Rose + Yassine ouvrent ensemble à 09:50 (commande), Jennyfer ou Emma ferme.",
 "• Rose en ouverture du lundi au vendredi (part toujours avant la fermeture), sauf un jour par semaine où elle commence à 12h (jeu 26/11, ven 4/12, jeu 10/12) : Emma ouvre ce jour-là.",
 "• Yassine tous les dimanches, avec Sara et Emma (Jennyfer le 13/12 : son seul dimanche du mois, Emma étant indispo). Jennyfer toujours en fermeture.",
 "• Indispos : Emma ven 27/11, mer 2/12 matin, ven 11 → dim 13/12 · Jennyfer dim 6 et lun 7/12.",
]
