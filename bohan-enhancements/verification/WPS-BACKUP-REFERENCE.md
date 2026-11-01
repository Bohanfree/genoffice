# WPS backup reference for Windows revision 4

On 2026-11-01, REA 6.8.0 from [morluto/rea](https://github.com/morluto/rea)
was used to statically analyze three JavaScript resources in the locally installed
WPS 12.1.0.29161 cloud-document UI: settings, cloud settings and transfer history.
All three parsed without syntax failures. Evidence identity:
`ev_9cf36a2139da04d53db7eeecf2674209be50af4b3b266068302a4c4171707d08`.
The full evidence and proprietary resources remain outside this repository.

The settings describe automatic cloud backup when a local document is opened,
and immediate upload when a saved document has changed. The transfer UI displays
the original filename, separately from file/task identity. Folder models also
separate display names from file and parent identifiers. These observations informed
the independently written GenOffice backup behavior: readable document names,
save-triggered updates and local identity/queue management.

This is a limited static observation, not a reconstruction of WPS cloud storage.
Only three of 63 inventoried relevant files were selected; dynamic/native
relationships remain unknown, and semantic retention limits were reached in two
files. No WPS cloud account was accessed, no WPS upload was triggered and no claim
is made about its server-side storage, conflict protocol or versioning algorithm.
GenOffice uses WebDAV conditional PUT and local snapshots on its own design.
