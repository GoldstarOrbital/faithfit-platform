# wearable-ingest service

Stub REST microservice. Port: 4004

## Responsibilities
See section 1 of platform spec for this service's role in the FaithFit architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t faithfit-wearable-ingest .
docker run -p 4004:4004 faithfit-wearable-ingest
```
