# multi_property_lock_codes.py - TTLock API helper module
import requests
import os
import time
import json

# Credentials (set by calling script from environment)
CLIENT_ID = None
ACCESS_TOKEN = None
CLIENT_SECRET = '19e2a1afb5bfada46f6559c346777017'  # required for refresh flow
OAUTH_HOST = 'https://api.sciener.com'
TTLOCK_API_BASE = 'https://euapi.ttlock.com'
TOKEN_FILE = 'ttlock_token.json'

# Property configuration: maps property_location to lock IDs
# Structure: {property_name: {"FRONT_DOOR_LOCK_ID": lock_id, "ROOM_LOCK_IDS": {"Room 1": lock_id, ...}}}
PROPERTIES = {
    "Tooting": {
        "FRONT_DOOR_LOCK_ID": 20641052,
        "ROOM_LOCK_IDS": {
            'Room 1': 21318606,
            'Room 2': 21321678,
            'Room 3': 21319208,
            'Room 4': 21321180,
            'Room 5': 21321314,
            'Room 6': 21973872,
        },
    },
    "Streatham": {
        "FRONT_DOOR_LOCK_ID": 16273050,
        "ROOM_LOCK_IDS": {
            'Room 1': 24719576,
            'Room 2': 24641840,
            'Room 3': 24719570,
            'Room 4': 24746950,
            'Room 5': 24717236,
            'Room 6': 24717242,
            'Room 7': None,
            'Room 8': None,
            'Room 9': 24692300,
            'Room 10': 24717964,
            'Room 11': None,
        },
    },
    "Norwich": {
        "FRONT_DOOR_LOCK_ID": 17503964,
        "ROOM_LOCK_IDS": {
            'Room 1': None,
            'Room 2': None,
            'Room 3': None,
            'Room 4': None,
            'Room 5': None,
        },
    },
}
