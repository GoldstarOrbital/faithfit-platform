# notification service

Stub REST microservice. Port: 4009

## Responsibilities
See section 1 of platform spec for this service's role in the FaithFit architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t faithfit-notification .
docker run -p 4009:4009 faithfit-notification
```
