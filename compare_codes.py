#!/usr/bin/env python3
"""
Compare desired codes (from bookings.csv) vs actual codes (from TTLock API).
Identifies missing, expired, and correctly set codes.
"""

import csv
import os
from datetime import datetime

def load_bookings():
    """Load desired bookings from bookings.csv"""
    desired = {}
    try:
        with open('bookings.csv', 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (row['property_location'], row['door_number'])
                desired[key] = {
                    'reservation_code': row['reservation_code'],
                    'guest_name': row['guest_name'],
                    'check_in': row['check_in'],
                    'check_out': row['check_out']
                }
    except FileNotFoundError:
        print("⚠️  bookings.csv not found")
    return desired

def load_actual_codes():
    """Load actual codes from ttlock_log.csv"""
    actual = {}
    try:
        with open('ttlock_log.csv', 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (row['property_location'], row['door_number'])
                if key not in actual:
                    actual[key] = []
                actual[key].append({
                    'guest_name': row['guest_name'],
                    'code': row['code_created'],
                    'status': row['ttlock_response'],
                    'timestamp': row['timestamp']
                })
    except FileNotFoundError:
        print("⚠️  ttlock_log.csv not found")
    return actual

def compare_codes():
    """Compare desired vs actual codes"""
    desired = load_bookings()
    actual = load_actual_codes()
    
    print("📑 CODE DISCREPANCY REPORT")
    print("="*80)
    print(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    missing = []
    incorrect = []
    correct = []
    
    # Check each desired booking
    for (prop, door), booking in desired.items():
        if (prop, door) not in actual:
            missing.append({
                'property': prop,
                'door': door,
                'guest': booking['guest_name'],
                'reservation': booking['reservation_code'],
                'reason': 'NOT SET ON LOCK'
            })
        else:
            # Check if the most recent code matches
            actual_codes = actual[(prop, door)]
            latest = actual_codes[-1]
            
            if latest['status'] == 'success':
                correct.append({
                    'property': prop,
                    'door': door,
                    'guest': booking['guest_name'],
                    'code': latest['code']
                })
            else:
                incorrect.append({
                    'property': prop,
                    'door': door,
                    'guest': booking['guest_name'],
                    'reason': f"Status: {latest['status']}"
                })
    
    # Report missing codes
    if missing:
        print(f"🚨 MISSING CODES ({len(missing)})")
        print("-"*80)
        for item in missing:
            print(f"Property: {item['property']}")
            print(f"  Door: {item['door']}")
            print(f"  Guest: {item['guest']}")
            print(f"  Reservation: {item['reservation']}")
            print(f"  Issue: {item['reason']}\n")
    
    # Report incorrect codes
    if incorrect:
        print(f"⚠️  INCORRECT CODES ({len(incorrect)})")
        print("-"*80)
        for item in incorrect:
            print(f"Property: {item['property']}")
            print(f"  Door: {item['door']}")
            print(f"  Guest: {item['guest']}")
            print(f"  Issue: {item['reason']}\n")
    
    # Report correct codes
    if correct:
        print(f"✅ CORRECT CODES ({len(correct)})")
        print("-"*80)
        for item in correct:
            print(f"Property: {item['property']}")
            print(f"  Door: {item['door']}")
            print(f"  Guest: {item['guest']}")
            print(f"  Code: {item['code']}\n")
    
    # Summary
    print("="*80)
    print("📊 SUMMARY")
    print(f"  Desired codes: {len(desired)}")
    print(f"  ✅ Correct: {len(correct)}")
    print(f"  🚨 Missing: {len(missing)}")
    print(f"  ⚠️  Incorrect: {len(incorrect)}")
    print(f"  Success rate: {len(correct)}/{len(desired)} ({100*len(correct)//len(desired) if desired else 0}%)")
    print("="*80)
    
    # Export comparison to CSV
    with open('code_comparison.csv', 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['property', 'door', 'guest', 'status', 'issue'])
        writer.writeheader()
        
        for item in missing:
            writer.writerow({'property': item['property'], 'door': item['door'], 'guest': item['guest'], 'status': 'MISSING', 'issue': item['reason']})
        
        for item in incorrect:
            writer.writerow({'property': item['property'], 'door': item['door'], 'guest': item['guest'], 'status': 'INCORRECT', 'issue': item['reason']})
        
        for item in correct:
            writer.writerow({'property': item['property'], 'door': item['door'], 'guest': item['guest'], 'status': 'CORRECT', 'issue': ''})
    
    print(f"\n💾 Detailed report exported to: code_comparison.csv")

if __name__ == '__main__':
    compare_codes()
