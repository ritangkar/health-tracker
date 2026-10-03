zip-python-store.zip    made with Python zipfile, ZIP_STORED: hello.txt ("hello world\n"), sub/data.bin (bytes 0..255), empty.txt (empty)
zip-python-deflate.zip  same contents, ZIP_DEFLATED (reader must reject: only store-only zips are supported)
zip-truncated.zip       zip-python-store.zip with the last 40 bytes cut off (reader must reject)
Used by tests/tests-backup.js. Synthetic data only. Owner: A2.
