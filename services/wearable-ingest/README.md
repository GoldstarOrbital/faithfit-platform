# wearable-ingest service

Stub REST microservice. Port: 4004

## Responsibilities
See section 1 of platform spec for this service's role in the Functioning Faith architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t functioning-faith-wearable-ingest .
docker run -p 4004:4004 functioning-faith-wearable-ingest
```
