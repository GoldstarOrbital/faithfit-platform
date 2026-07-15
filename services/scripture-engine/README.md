# scripture-engine service

Stub REST microservice. Port: 4005

## Responsibilities
See section 1 of platform spec for this service's role in the FaithFit architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t faithfit-scripture-engine .
docker run -p 4005:4005 faithfit-scripture-engine
```
