# EventSync

### Every Vendor. One Event. Perfectly Coordinated.

**EventSync** is a proposed local event vendor coordination platform
designed to help event organizers discover suitable vendors, compare
options, manage booking requests, and coordinate multiple services from
one place.

It addresses **Problem Statement 47: Local Event Vendor Coordination**
for the **CBC 2.0 Design Round**.

> **Project status:** Hackathon concept / planned MVP. Features and
> architecture described below represent the proposed solution; update
> this README as implementation progresses.

------------------------------------------------------------------------

## Table of Contents

-   [Problem Statement](#problem-statement)
-   [Our Solution](#our-solution)
-   [Target Users](#target-users)
-   [Key Features](#key-features)
-   [How It Works](#how-it-works)
-   [Booking Lifecycle](#booking-lifecycle)
-   [Architecture](#architecture)
-   [Proposed Tech Stack](#proposed-tech-stack)
-   [Data Model](#data-model)
-   [Edge Cases and Reliability](#edge-cases-and-reliability)
-   [MVP Scope](#mvp-scope)
-   [Future Enhancements](#future-enhancements)
-   [Getting Started](#getting-started)
-   [Environment Variables](#environment-variables)
-   [Security and Privacy
    Considerations](#security-and-privacy-considerations)
-   [Team](#team)
-   [License](#license)

------------------------------------------------------------------------

## Problem Statement

Event organizers often need multiple vendors---such as caterers,
decorators, photographers, and sound providers---for one event. Finding
vendors, checking availability, comparing prices, confirming bookings,
and managing cancellations across separate calls, messages, and
spreadsheets can be difficult.

The problem becomes more serious when: - A vendor is unavailable on the
event date. - Multiple events request the same vendor for overlapping
time slots. - A vendor cancels after confirmation. - An organizer needs
to find a replacement quickly. - Organizers and vendors lack a shared
view of booking status and commitments.

## Our Solution

EventSync brings local event organizers and service vendors into one
coordination workflow. Organizers describe their event and service
requirements; the platform identifies compatible vendors using defined
criteria; both sides manage requests and commitments through clear
booking statuses.

**Our one-line solution:** We help event organizers find and coordinate
suitable local vendors through a centralized platform for
requirement-based matching, availability checks, and booking management.

## Target Users

### Event Organizers

-   Create events and specify date, location, attendance, budget, and
    required services.
-   Discover and compare vendors.
-   Send booking requests and review counteroffers.
-   Track each service's booking status.
-   Find alternatives if a vendor declines or cancels.

### Local Vendors

-   Create a profile with services, service areas, capacity, pricing,
    and availability.
-   Receive requests with relevant event details.
-   Accept, decline, or counteroffer a request.
-   Manage existing commitments and avoid incompatible bookings.
-   Build a reliability history based on verified booking activity.

Example vendor categories include catering, decoration, photography,
sound and lighting, and other local event services.

## Key Features

1.  **Requirement-Based Vendor Matching**\
    Match vendors by service category, date and time, location,
    capacity, and budget compatibility.

2.  **Search and Filters**\
    Help organizers narrow results by relevant service requirements and
    preferences.

3.  **Local Vendor Directory**\
    Present vendor profiles, service details, service areas, indicative
    pricing or quotes, capacity, and availability.

4.  **Booking Requests and Confirmation**\
    Keep vendor selection separate from booking confirmation. A booking
    is confirmed only after the vendor accepts and availability is
    validated.

5.  **Counteroffers and Negotiation**\
    Allow vendors to propose revised prices or terms. The organizer must
    accept the counteroffer before the revised terms become agreed.

6.  **Two-Sided Reliability Ratings**\
    Use verified booking history and fair cancellation rules to help
    organizers and vendors assess reliability. Ratings should not be
    based solely on an unverified complaint.

7.  **Booking and Event Status Tracking**\
    Show pending, confirmed, declined, and cancelled service requests in
    one event dashboard.

8.  **Cancellation Recovery**\
    Notify the organizer when a confirmed vendor cancels and help
    discover replacement vendors. The organizer selects the replacement,
    and the new vendor must accept.

9.  **Advance Booking Commitment (Planned)**\
    The platform may support an agreed advance payment---for example,
    30% of the booking amount---if payment integration, refund rules,
    and cancellation terms are implemented. This percentage is a
    proposed example, not a fixed policy.

## How It Works

1.  **Create an event:** The organizer enters the event date, time,
    venue, expected attendance, budget, and required services.
2.  **Define service needs:** Each service has its own requirements,
    such as guest capacity, duration, equipment, and service budget.
3.  **Find compatible vendors:** The matching engine filters vendors
    using hard requirements such as service type, availability,
    location, and capacity.
4.  **Compare and select:** The organizer reviews eligible vendors,
    quotes, and relevant profile information.
5.  **Request a booking:** The system sends the vendor the necessary
    event and service details.
6.  **Negotiate if needed:** The vendor can accept, decline, or
    counteroffer.
7.  **Confirm safely:** Before confirming, the system checks that the
    vendor can take the commitment without an incompatible scheduling or
    capacity conflict.
8.  **Track the event:** The organizer sees the status of each required
    service.
9.  **Recover from cancellations:** If a vendor cancels, the system
    marks the booking cancelled and supports matching with alternatives.

## Booking Lifecycle

A booking request should follow explicit states:

-   `Draft` --- the organizer is preparing a request.
-   `Pending` --- the request has been sent and awaits a vendor
    decision.
-   `Counteroffered` --- the vendor has proposed revised terms.
-   `Confirmed` --- both sides have agreed, and the final availability
    check has passed.
-   `Declined` --- the vendor has declined the request.
-   `Cancelled` --- a previously requested or confirmed booking has been
    cancelled according to the applicable workflow.
-   `Completed` --- the service has been delivered and the booking can
    contribute to verified reliability history.

The implementation may simplify this state list for the MVP, but it
should preserve the distinction between a request, a vendor's
acceptance, and a confirmed booking.

## Architecture

The proposed architecture separates the user interface, business logic,
and data storage.

``` text
Organizer / Vendor
        |
        v
Next.js Web Application
        |
        v
Node.js + Express REST API
        |
        +--> Authentication and authorization
        +--> Event and service requirements
        +--> Vendor matching and filters
        +--> Availability and booking validation
        +--> Counteroffers and cancellations
        +--> Reliability and booking history
        |
        v
Supabase PostgreSQL
        |
        +--> User profiles
        +--> Vendor profiles and availability
        +--> Events and event services
        +--> Booking requests and status history
```

### Proposed Tech Stack

  -----------------------------------------------------------------------
  Layer                   Technology              Purpose
  ----------------------- ----------------------- -----------------------
  UI design               Google Stitch           Generate and iterate on
                                                  interface concepts

  Frontend                Next.js                 Organizer and vendor
                                                  web interfaces

  Language                TypeScript              Type-safe frontend
                                                  development

  Styling                 Tailwind CSS            Responsive interface
                                                  styling

  Backend                 Node.js + Express.js    REST APIs and business
                                                  rules

  Database                Supabase PostgreSQL     Relational event,
                                                  vendor, and booking
                                                  data

  Authentication          Supabase Auth           User sign-in and
                                                  identity management

  Matching                Rule-based logic        Deterministic filtering
                                                  of compatible vendors

  API communication       REST APIs               Connect frontend and
                                                  backend
  -----------------------------------------------------------------------

This stack is a proposal for the MVP, not a claim that all components
have already been implemented. Google Stitch is a design aid; generated
designs still need to be reviewed and implemented in the application.

## Data Model

The main entities are expected to include:

-   **User:** user ID, name, email, and role.
-   **VendorProfile:** vendor ID, service categories, service area,
    capacity, pricing information, and profile details.
-   **Availability:** vendor ID, date/time windows, availability state,
    and capacity where relevant.
-   **Event:** organizer ID, event name, date/time, venue, attendance,
    and overall budget.
-   **EventService:** event ID, service category, requirements, capacity
    needed, and service budget.
-   **Booking:** event service, vendor, status, quote or agreed price,
    timestamps, and cancellation details.
-   **BookingHistory:** status transitions and relevant actions used for
    auditing and reliability calculations.

An event can contain multiple service requirements. A service may
receive multiple requests over time, but the system must prevent
incompatible confirmed commitments for a vendor.

## Edge Cases and Reliability

### Vendor unavailable on the event date

Exclude the vendor from immediately bookable matches, or clearly mark
availability as unverified. Offer other compatible vendors where
available.

### Multiple organizers request the same vendor

Pending requests must not be treated as confirmed commitments. Recheck
current availability and capacity during confirmation. Use database
transactions or equivalent atomic safeguards so two simultaneous
requests cannot create an incompatible double booking.

### Vendor cancels after confirmation

Mark the booking as cancelled, notify the organizer, and offer
compatible replacement options. A replacement is not confirmed until the
organizer chooses it and the new vendor accepts.

### No suitable vendor is found

Show that no compatible match is available. Do not silently ignore hard
requirements or present an incompatible vendor as a valid match.

### Unfair ratings or cancellations

Use verified booking events and clearly defined rating rules.
Distinguish last-minute cancellations from timely cancellations and
allow appropriate treatment of documented emergencies or disputes.

## MVP Scope

### Must Have

-   Event and service requirement management.
-   Vendor profiles and availability.
-   Requirement-based vendor matching and filters.
-   Booking requests and vendor accept/decline actions.
-   Booking confirmation and event status tracking.
-   Handling for vendor unavailability, conflicting requests, and
    cancellations.
-   Basic replacement vendor discovery.

### Stretch Features

-   Vendor ranking and budget comparison.
-   Counteroffers and negotiation history.
-   Two-sided reliability ratings.
-   Notifications and booking reminders.
-   Advance payments and payment-status tracking.

### Future Enhancements

-   Payment gateway integration and structured refund handling.
-   Verified vendor onboarding.
-   Reviews after completed bookings.
-   Analytics for organizers and vendors.
-   More advanced matching and recommendation features.
-   Expansion to more cities and service categories.

## Getting Started

The following is a suggested local setup once the application source
code has been created. Repository paths and scripts may need to be
adjusted to match the actual implementation.

### Prerequisites

-   Node.js LTS and npm.
-   A Supabase project.
-   Git.
-   A Google Stitch account if using it for UI design.

### Suggested repository structure

``` text
eventsync/
├── frontend/              # Next.js application
├── backend/               # Express API
├── docs/                  # Architecture, workflow, and design notes
├── .gitignore
└── README.md
```

### 1. Clone the repository

``` bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd eventsync
```

Replace the placeholder URL with the actual repository URL.

### 2. Configure the frontend

``` bash
cd frontend
npm install
```

Create a `.env.local` file using the variables described below, then run
the development server using the script defined in `package.json`,
commonly:

``` bash
npm run dev
```

### 3. Configure the backend

In a separate terminal:

``` bash
cd backend
npm install
```

Create a `.env` file with the backend configuration and run the script
defined in `package.json`. For a typical Express setup, this may be:

``` bash
npm run dev
```

The exact scripts depend on the implementation and must be defined in
each package's `package.json`.

### 4. Configure Supabase

1.  Create a Supabase project.
2.  Define the required database tables and relationships.
3.  Configure authentication and row-level security policies.
4.  Add the appropriate environment variables to the frontend and
    backend.
5.  Test authorization and booking-conflict scenarios before using real
    user data.

Do not commit real secrets or service-role keys to GitHub.

## Environment Variables

Use placeholders only in documentation. Store actual values in local
environment files that are excluded from Git.

### Frontend --- example `.env.local`

``` dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

Use the current Supabase publishable key format recommended by your
project settings if applicable. Never expose a Supabase secret or
service-role key in a `NEXT_PUBLIC_` variable.

### Backend --- example `.env`

``` dotenv
PORT=5000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Only use a service-role key on the trusted server when genuinely
required. Prefer appropriately scoped access and database policies.
Never expose it to browser code or commit it to source control.

Example `.gitignore` entries:

``` gitignore
node_modules/
.next/
.env
.env.local
.env.*
!.env.example
dist/
coverage/
```

## Security and Privacy Considerations

-   Enforce role-based authorization for organizers and vendors.
-   Apply Supabase Row Level Security policies to protect private
    records.
-   Validate user input and booking state transitions on the server.
-   Recheck vendor availability when confirming a booking.
-   Protect contact details and event information from unauthorized
    access.
-   Store only necessary personal information.
-   Define transparent terms for advance payments, cancellations,
    refunds, and disputes before enabling real payments.
-   Keep credentials and secret keys out of GitHub and client-side code.

## Team

**Team Name:** THE LAST COMMIT\
**Project:** EventSync\
**Problem Statement:** 47 --- Local Event Vendor Coordination\
**Domain:** Software & Web Development\
**Team Lead:** Bhargav Hathwar G

## License

A license has not yet been selected. Before making the repository public
for reuse, choose an appropriate license and add a `LICENSE` file. Until
then, do not assume that others have permission to reuse the project's
code.

------------------------------------------------------------------------

**EventSync --- Every Vendor. One Event. Perfectly Coordinated.**
