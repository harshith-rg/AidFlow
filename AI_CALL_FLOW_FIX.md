# AI Call flow fix

The User AI Call intake now collects the emergency details in this order:

1. Emergency type
2. Patient consciousness
3. Breathing condition
4. 10-digit contact phone number
5. Patient name
6. Special context (numbered choices: 1 Road accident, 2 Heart attack / chest pain, 3 Breathing difficulty, 4 Stroke symptoms, 5 Severe bleeding, 6 Burns, 7 Fall / fracture, 8 Seizure, 9 Pregnancy-related emergency, 10 Poisoning, 11 Other; 0 means none)
7. Device GPS coordinates (detected automatically)

The AI asks for the contact phone before the patient name, then reads out the numbered special-context options. Selecting **Report emergency to Control Room** sends those contact values to the backend in separate turns, checks that both were saved, and then finalizes the emergency. The backend's existing `case:created` and `alert:new` Socket.IO events then notify the Control Room.

The review form stays open if submission fails, so the caller can correct the details and retry without restarting the call. Starting a new call clears prior contact fields.

This is an academic simulation only, not a real emergency dispatch service.
