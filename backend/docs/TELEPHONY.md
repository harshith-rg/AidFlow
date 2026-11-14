# AidFlow Simulated Telephony & Driver IVR Specification

AidFlow features an entirely simulated, software-defined telephony subsystem. It allows full demonstration of inbound helpline calls and outbound automated driver voice calls without contacting real telephone networks, SMS gateways, or emergency numbers (108/112/911).

---

## 1. Safety Guarantees (Ground Rules 3 & 7)

- `TELEPHONY_PROVIDER=simulated` is the only allowed setting. Any attempt to specify an external provider throws a fatal configuration error at startup.
- Every call session, event, and API response carries `simulated: true`.
- The display helpline number is strictly labelled: `1800-000-0000 (DEMO NUMBER)`.

---

## 2. Inbound Helpline Simulation (Bystander -> Call Center)

1. **Trigger**: Bystander clicks "Simulate Incoming Call" on the landing page or `POST /calls/incoming`.
2. **Session Creation**:
   - `direction = 'inbound_caller'`
   - `status = 'ringing'`
   - `to_number = '1800-000-0000'`
   - Event `call:incoming` emitted to `role:admin`.
3. **Operator Interaction**:
   - Operator clicks **Answer** in the Call Centre console (`POST /calls/:id/answer`).
   - Session transitions to `in_progress`.
   - Call audio chime stops.
4. **Emergency Registration**:
   - Operator fills the intake triage form.
   - Clicking **Register Emergency** executes `POST /calls/:id/register-emergency`.
   - Links the call session to the newly created case (`source = 'call'`).
   - Case code (e.g. `EMG-2026-0001`) is returned and displayed to the caller.

---

## 3. Outbound Driver IVR State Machine (System -> Ambulance Driver)

```
[dispatch.offerNext]
        ↓
Insert outbound_driver call session ('ringing')
        ↓
Emit call:incoming to driver:<ambulanceId>
Audio Prompt: "Emergency request near you. Press 1 to accept, 2 to reject."
        ↓
┌───────────────────────┬───────────────────────┐
↓                       ↓                       ↓
Digit '1'               Digit '2'               No Input (20s)
• POST /calls/:id/dtmf  • POST /calls/:id/dtmf  • Sweeper / timer expires
• Calls acceptAttempt   • Calls rejectAttempt   • Session marked 'missed'
• Call 'completed'      • Call 'completed'      • Reason: 'timed_out'
• Ambulance busy        • Offer next ambulance  • Offer next ambulance
```

### 3.1 Race Condition Safety
If a driver presses digit `1` while simultaneously accepting via the mobile app, or vice versa, the transaction lock `FOR UPDATE` on `dispatch_attempts` ensures that the second request immediately receives `409 CONFLICT ("Offer has expired or was already answered")` without double booking.
