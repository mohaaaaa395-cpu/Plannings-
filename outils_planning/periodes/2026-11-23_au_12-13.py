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

# Période des fêtes : 3 personnes du jeudi au dimanche. Mardi : Rose + Yassine ouvrent ensemble (commande).
# Rose toujours en ouverture, Jennyfer toujours en fermeture. Dimanche : Rose OU Yassine, une semaine sur deux.
W1 = [  # 23 -> 29 novembre : dimanche Rose
 {'Rose': OUV7, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': OUV7, 'Jennyfer': JF},
 {'Emma': E_OUV, 'Yassine': YFER},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF},
 {'Sara': SAT_SARA, 'Emma': E_MID, 'Yassine': YFER},
 {'Rose': SUN_ROSE, 'Sara': SUN_SARA, 'Emma': E_SUN},
]
W2 = [  # 30 novembre -> 6 décembre : dimanche Yassine (Jennyfer indispo dim 6)
 {'Emma': E_OUV, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': OUV7, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YFER},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF},
 {'Rose': OUV7, 'Emma': E_MID, 'Jennyfer': JF},
 {'Rose': OUV7, 'Sara': SAT_SARA_MID, 'Yassine': YFER},
 {'Sara': SUN_SARA, 'Yassine': SUN_Y, 'Emma': E_SUN, 'Jennyfer': ('INDISPONIBLE', 0)},
]
W3 = [  # 7 -> 13 décembre : dimanche Rose (Jennyfer indispo lun 7)
 {'Rose': OUV7, 'Yassine': YFER, 'Jennyfer': ('INDISPONIBLE', 0)},
 {'Rose': OUV7, 'Yassine': OUV7, 'Jennyfer': JF},
 {'Emma': E_OUV, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF},
 {'Rose': OUV7, 'Yassine': YMID, 'Jennyfer': JF},
 {'Sara': SAT_SARA, 'Emma': E_MID, 'Yassine': YFER},
 {'Rose': SUN_ROSE, 'Sara': SUN_SARA, 'Emma': E_SUN},
]
WEEKS = [(dt.date(2026, 11, 23), W1), (dt.date(2026, 11, 30), W2), (dt.date(2026, 12, 7), W3)]
NOTES = [
 "• Période des fêtes : 3 personnes du jeudi au dimanche ; 2 le lundi et le mercredi ; 3 le mardi (Rose + Yassine ouvrent ensemble à 09:50 pour la commande, Jennyfer ferme).",
 "• Rose toujours en ouverture, elle part toujours avant la fermeture ; Jennyfer toujours en fermeture ; Yassine en fermeture ou milieu de journée (sauf le mardi).",
 "• Dimanche : Rose (29/11 et 13/12) ou Yassine (6/12), jamais les deux, avec Sara et Emma.",
 "• Emma (nouvelle, 20h, a les clés) : 3 jours par semaine ; elle ouvre le lundi ou le mercredi où Rose est en repos.",
 "• Jennyfer indispo dim 6 et lun 7 décembre.",
]
