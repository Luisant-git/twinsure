# Twinsure User Dashboard PRD (Product Requirements Document)

## 1. Product Overview
### Product Name
Twinsure Customer Dashboard
### Purpose
The Twinsure Customer Dashboard is a mobile-first self-service portal that enables insurance customers to manage their policies, upload KYC documents, request insurance services, schedule appointments, communicate with Twinsure representatives, and receive updates regarding their insurance activities.
The dashboard should significantly reduce manual communication while increasing customer engagement and lead conversion opportunities.
### Primary Goal
Provide a simple, trustworthy, and professional insurance management experience where customers can:
* Upload and manage policies
* Request assistance
* Schedule consultations
* Complete KYC verification
* Receive policy-related updates
* Access Twinsure's specialized insurance services
### Target Users
* Existing insurance customers
* Prospective insurance customers
* Customers requiring claims support
* Customers seeking policy auditing
* Customers seeking renewal assistance
---

# 2. Design Philosophy
### Mobile First
The dashboard must be designed primarily for mobile devices.
Expected Usage:
* Mobile Users: 90%
* Desktop Users: 10%
### Design Inspiration
* Google Pay
* PhonePe
* CRED
* Zerodha
* Modern Banking Applications
### Design Principles
* Minimal learning curve
* Maximum accessibility
* Important actions within 2 taps
* Trust-focused design
* Fast interaction flow
* Large touch targets
* Modern fintech appearance
---

# 3. Layout Structure
## Mobile Layout
### Top Navigation Bar
Fixed Header
Contents:
Left:
* Twinsure Logo
Right:
* Notification Bell Icon
* User Profile Avatar
Behavior:
Notification Bell:
* Opens Updates Center
Profile Avatar:
* Opens Profile Section
Header Style:
* Glassmorphism effect
* Slight blur background
* Sticky on scroll
the sample ui screenshots were attached with the code for refernce purpose just to understand the requirement and the same exact 100% ui is required.
---
### Bottom Navigation
Fixed Navigation Bar
Items:
1. Home
2. Policies
3. Services
4. Appointments
5. Updates
Active Tab:
Highlighted using Twinsure Primary Color
Reason:
These are the most frequently used actions.
Profile intentionally removed from bottom navigation to prioritize customer workflows.
---
### Floating Actions
Visible Across Entire Dashboard
#### WhatsApp Button
Position:
Bottom Right
Purpose:
Instant support access
Behavior:
Open WhatsApp conversation
---
#### AI Assistant Button
Position:
Above WhatsApp Button
Purpose:
Customer assistance
Functions:
* Service guidance
* FAQ support
* Policy assistance
* Audit guidance
Not intended for policy recommendations.
---

# 4. Home Dashboard
## Purpose
Central command center for customers.
---
## Welcome Section
Display:
Good Morning, [Customer Name]
Verification Status
Examples:
KYC Verified
KYC Pending
KYC Rejected
---
## Quick Action Section
Grid Layout
Actions:
1. Upload Policy
2. Request Service
3. Book Appointment
4. AI Policy Audit
Behavior:
Single tap access.
Most used actions must be accessible immediately.
---
## Service Shortcuts
Dedicated cards for:
### Icare
Health Insurance Support
### Re.New.All
Renewal Management Service
### HosPos
Hospital Assistance Service
### Pre Policy Audit
AI Assisted Policy Audit
---
## Recent Activity Section
Shows:
* Policy Approved
* Policy Under Review
* Appointment Confirmed
* Service Assigned
* KYC Approved
Displayed as timeline cards.
---
## Notification Summary
Latest 3 notifications visible.
View All redirects to Updates Tab.
---

# 5. Policies Module
## Purpose
Allow users to upload and manage insurance policies.
---
## Policy Listing
Card-Based Design
Each Card Displays:
* Insurance Company
* Policy Number
* Policy Type
* Upload Date
* Verification Status
Status Types:
* Pending
* Approved
* Rejected
---
## Policy Actions
Each policy card includes:
* View
* Download
* Contact Agent
---
## Add Existing Policy
Button:
* Add Existing Policy
---
### Form Fields
Policy Number
Insurance Provider
Policy Type
Policy PDF Upload
Notes
Submit
---
### Verification Flow
Customer Uploads Policy
↓
Employee Reviews Policy
↓
Approval / Rejection
↓
Customer Notified
---
## Future Features
Reserved for:
* Policy Insights
* Renewal Alerts
* Claim Tracking
---

# 6. Services Module
## Purpose
Generate qualified leads and service requests.
---
## Service Categories
### Icare
Features:
* Health Insurance Assistance
* Claims Guidance
* Coverage Consultation
---
### Re.New.All
Features:
* Renewal Management
* Multi-policy Tracking
* Renewal Consultation
---
### HosPos
Features:
* Hospital Support
* Cashless Claims Assistance
* Emergency Guidance
---
### Pre Policy Audit
Features:
* Policy Analysis
* Coverage Gap Detection
* Risk Assessment
* Consultation Booking
---
## Service Request Form
Fields:
Service Category
Description
Preferred Contact Time
Additional Notes
Submit
---
## Service Status Tracking
Statuses:
Submitted
Assigned
In Progress
Completed
---

# 7. Appointments Module
## Purpose
Allow customers to connect with Twinsure representatives.
---
## Appointment Types
### Request a Call
### Visit Office
---
## Request a Call Form
Phone Number
Auto-filled from account
Read-only
---
Alternative Phone Number
Optional
---
Preferred Date
Preferred Time
Alternative Time
Purpose
Remarks
Submit
---
## Visit Office Form
Visit Date
Visit Time
Purpose
Remarks
Submit
---
## Appointment Workflow
Submitted
↓
Confirmed
↓
Completed
Timeline visible to customer.
---

# 8. Updates Module
## Purpose
Central notification center.
---
## Categories
Policies
Appointments
Services
KYC
General Announcements
---
## Notification Types
Policy Approved
Policy Rejected
Appointment Confirmed
Agent Assigned
KYC Verified
Renewal Reminder
Document Request
---
## Filters
All
Policies
Appointments
Services
KYC
---

# 9. Profile Module
Accessed through top-right profile avatar.
---
## Personal Information
Fields:
Name
Phone
Email
Date of Birth
Gender
Address
City
State
Pincode
Emergency Contact
---
## Edit Profile
Customer can update:
* Email
* Address
* City
* State
* Emergency Contact
Phone number remains protected.
---

# 10. KYC Management
## Documents
Aadhaar
PAN
Voter ID
Photo
---
## Actions
View
Replace
Download
---
## Verification Status
Pending
Approved
Rejected
---
## Verification Workflow
Customer Uploads
↓
Employee Reviews
↓
Approve / Reject
↓
Notification Sent
---

# 11. Security Settings
## Change Password
Fields:
Current Password
New Password
Confirm Password
---
Password Rules
Minimum 8 Characters
Uppercase Letter
Lowercase Letter
Number
Special Character
---
## Security Activity
Last Login
Password Changed Date
Active Sessions (Future)
---

# 12. User Experience Enhancements
## Grid Background
Entire dashboard uses:
* Dark background
* Subtle gray vertical grid lines
* Subtle gray horizontal grid lines
Must not interfere with cards.
---
## Card Design
Style:
* Rounded Corners
* Soft Shadow
* Glass Effect
* Hover Effects (Desktop)
---
## Status Indicators
Approved:
Green Glow
Pending:
Amber Glow
Rejected:
Red Glow
---
## Animations
Micro-interactions only.
Examples:
* Card hover
* Button press
* Loading states
* Status transitions
No excessive animations.
---

# 13. Responsive Behavior
## Mobile
Primary Design Target
Bottom Navigation Active
---
## Tablet
Adaptive Layout
Two-column grids
---
## Desktop
Left Sidebar Navigation
Menu:
* Home
* Policies
* Services
* Appointments
* Updates
Bottom Section:
My Profile
Right-side content area remains unchanged.
# Success Metrics
* Policy Upload Completion Rate
* Service Request Conversion Rate
* Appointment Booking Rate
* KYC Completion Rate
* Customer Retention
* Consultation Conversion Rate
* Customer Satisfaction Score
* Average Resolution Time